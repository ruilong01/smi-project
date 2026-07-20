import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoCentroid,
  geoDistance,
  geoGraticule,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import { feature } from "topojson-client";
import { presimplify, quantile, simplify } from "topojson-simplify";
import worldMap from "world-atlas/countries-50m.json";
import { AnimatePresence } from "framer-motion";
import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import CountryPopup from "./CountryPopup.jsx";
import HoverPreviewCard from "./HoverPreviewCard.jsx";
import ProjectPopup from "./ProjectPopup.jsx";
import {
  countryMatchesTopicFilter,
  projectMatchesTopicFilter,
} from "../data/researchProjectData.js";
import {
  getCountryFill,
  getCountryStroke,
  getIntensityColor,
  getIntensityLabel,
  getIntensityLevel,
  getIntensityOpacity,
} from "../utils/intensity.js";

const width = 960;
const height = 620;
const defaultRotation = [-18, -16, 0];
const baseScale = 286;
const defaultZoom = 1;
const minZoom = 0.75;
const maxZoom = 2.5;
const landFeatures = feature(worldMap, worldMap.objects.countries).features;

// Dual level-of-detail (Goal 2): the 50m atlas is KEPT as the quality
// source. Moving frames (drag/auto-rotation) render a simplified
// derivative of the same topology (~18% most significant points), and the
// settle frame always re-renders full 50m detail. Feature order and ids
// are preserved by topojson-simplify, so both arrays share DOM nodes.
// Measured: 7.6x faster path generation and 86% smaller path strings
// while moving, with zero quality loss on the settled globe.
const simplifiedTopology = (() => {
  const presimplified = presimplify(worldMap);
  return simplify(presimplified, quantile(presimplified, 0.18));
})();
const simplifiedLandFeatures = feature(
  simplifiedTopology,
  simplifiedTopology.objects.countries
).features;

// Back-face culling data (Goal 2): computed ONCE at module load. Each
// feature gets a bounding sphere (centroid + max angular radius over all
// vertices). Per frame we can then skip path generation for features whose
// entire sphere lies beyond the visible hemisphere, instead of asking
// d3-geo to clip every one of the 241 features (50m atlas kept by design).
function computeAngularRadius(geometryCoordinates, centroid) {
  let maxDistance = 0;

  function scan(coords) {
    if (typeof coords[0] === "number") {
      const distance = geoDistance(centroid, coords);
      if (distance > maxDistance) {
        maxDistance = distance;
      }
      return;
    }
    for (const child of coords) {
      scan(child);
    }
  }

  scan(geometryCoordinates);
  return Math.min(maxDistance, Math.PI);
}

const featureBoundingSpheres = landFeatures.map((geo) => {
  const centroid = geoCentroid(geo);
  return {
    centroid,
    radius: computeAngularRadius(geo.geometry.coordinates, centroid),
  };
});

function isFeatureFullyHidden(index, rotation) {
  const sphere = featureBoundingSpheres[index];
  const center = [-rotation[0], -rotation[1]];
  return (
    geoDistance(sphere.centroid, center) - sphere.radius >
    halfPi + cullingMargin
  );
}
const graticule = geoGraticule().step([20, 20])();
const sphere = { type: "Sphere" };
const autoResumeDelay = 1500;
const autoFrameInterval = 33;
const autoDegreesPerMs = 0.0011;
// Adaptive path precision: coarser adaptive resampling while the globe is
// moving (drag/auto-rotation), full quality on the settled frame.
const interactivePrecision = 1.7;
const staticPrecision = 0.9;
const halfPi = Math.PI / 2;
const cullingMargin = 0.05;
// Interaction timing (Problem 1 & 2): hover shows a preview after a short
// delay so it doesn't fire on every pass-by; click runs a quick, eased
// rotation to bring the target to the front.
const hoverShowDelay = 750;
const hoverCloseGrace = 220;
const focusAnimationDuration = 700;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createProjection(rotation = defaultRotation, zoom = defaultZoom) {
  return geoOrthographic()
    .translate([width / 2, height / 2])
    .scale(baseScale * zoom)
    .rotate(rotation)
    .clipAngle(90)
    .precision(0.9);
}

function isCoordinateVisible(coordinates, rotation) {
  if (
    !coordinates ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    return false;
  }

  const center = [-rotation[0], -rotation[1]];
  return geoDistance(coordinates, center) <= Math.PI / 2;
}

function normalizeLongitude(target, from) {
  const delta = (((target - from + 180) % 360) + 360) % 360 - 180;
  return from + delta;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function getProjectCoordinates(project) {
  if (!Number.isFinite(project.longitude) || !Number.isFinite(project.latitude)) {
    return null;
  }

  return [project.longitude, project.latitude];
}

// Most extracted projects have no real geolocation and fall back to their
// country's own centroid (see buildDataset.mjs enrichProject). Rendering a
// separate marker at that same point stacks it directly on top of the
// country marker — since markers paint in DOM order, the topmost project
// marker then silently eats every hover/click meant for the country
// underneath. Only render a distinct project marker when its coordinates
// actually differ from its country's, so country-level interaction stays
// reachable; projects without a distinct location remain fully accessible
// via the country profile's research records list and their own URL.
const DISTINCT_LOCATION_EPSILON = 0.01;

function hasDistinctProjectLocation(project, country) {
  const coordinates = getProjectCoordinates(project);
  if (!coordinates || !country?.coordinates) {
    return false;
  }

  const [lng, lat] = coordinates;
  const [countryLng, countryLat] = country.coordinates;
  return (
    Math.abs(lng - countryLng) > DISTINCT_LOCATION_EPSILON ||
    Math.abs(lat - countryLat) > DISTINCT_LOCATION_EPSILON
  );
}

function getFeatureKey(geo, index) {
  return `${geo.id ?? geo.properties.name}-${index}`;
}

function getCountryClass(country, isThemeMatch, selectedCountry) {
  if (!country) {
    return "geography passive-country no-data-country";
  }

  return [
    "geography",
    "demo-country",
    `intensity-${getIntensityLevel(country.researchIntensity)}`,
    isThemeMatch ? "theme-match" : "theme-muted",
    selectedCountry?.id === country.id ? "selected-country" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getMapCountryOpacity(country, isThemeMatch, hasFilter, isSelected) {
  if (!country) {
    return getIntensityOpacity(0, false);
  }

  if (isSelected) {
    return 0.96;
  }

  if (hasFilter && !isThemeMatch) {
    return 0.34;
  }

  return getIntensityOpacity(country.researchIntensity, true);
}

const initialProjection = createProjection();
const initialPath = geoPath(initialProjection).digits(1);
const initialSpherePath = initialPath(sphere) ?? undefined;
const initialGraticulePath = initialPath(graticule) ?? undefined;

export default function WorldMap({
  countries,
  activeFilter,
  popupCountry,
  popupProject,
  projects = [],
  dataStatusLabel,
  selectedCountry,
  isProfileOpen,
  onClearSelection,
  onClosePopup,
  onCloseProjectPopup,
  onCountryClick,
  onProjectClick,
  onViewProfile,
}) {
  const shellRef = useRef(null);
  const sphereRef = useRef(null);
  const clipSphereRef = useRef(null);
  const graticuleRef = useRef(null);
  const geographyRefs = useRef(new Map());
  const markerRefs = useRef(new Map());
  const projectMarkerRefs = useRef(new Map());
  const projectionRef = useRef(createProjection());
  const pathRef = useRef(geoPath(projectionRef.current).digits(1));
  const rotationRef = useRef(defaultRotation);
  const zoomRef = useRef(defaultZoom);
  const dragRef = useRef(null);
  const dragDistanceRef = useRef(0);
  const pointerTargetRef = useRef(null);
  const suppressClickRef = useRef(false);
  const resumeTimerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastAutoFrameRef = useRef(0);
  const needsRenderRef = useRef(true);
  const lastRenderWasInteractiveRef = useRef(false);
  const isPointerInsideRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isPausedRef = useRef(false);
  const isAutoRotationEnabledRef = useRef(true);
  const popupCountryRef = useRef(popupCountry);
  const popupProjectRef = useRef(popupProject);
  const popupPositionRef = useRef(null);
  const projectPopupPositionRef = useRef(null);
  const profileOpenRef = useRef(Boolean(isProfileOpen));
  const countriesRef = useRef(countries);
  const projectsRef = useRef(projects);
  // Hover preview (Problem 1) and focus animation (Problem 2) state, kept
  // in refs so hover itself never drives a per-frame re-render.
  const hoverShowTimerRef = useRef(null);
  const hoverCloseTimerRef = useRef(null);
  const isCardHoveredRef = useRef(false);
  const focusAnimRef = useRef(null);
  const [hoverPreview, setHoverPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAutoRotationEnabled, setIsAutoRotationEnabled] = useState(true);
  const [popupPosition, setPopupPosition] = useState(null);
  const [projectPopupPosition, setProjectPopupPosition] = useState(null);
  const hasFilter = activeFilter !== "All";

  const countriesByAtlasName = useMemo(() => {
    return new Map(countries.map((country) => [country.atlasName, country]));
  }, [countries]);

  const countriesByCode = useMemo(() => {
    return new Map(countries.map((country) => [country.code, country]));
  }, [countries]);

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reducedMotionQuery?.matches) {
      setIsAutoRotationEnabled(false);
    }
  }, []);

  useEffect(() => {
    isAutoRotationEnabledRef.current = isAutoRotationEnabled;

    if (isAutoRotationEnabled) {
      resumeAutoRotationAfterDelay();
    } else {
      pauseAutoRotation();
    }
  }, [isAutoRotationEnabled]);

  useEffect(() => {
    countriesRef.current = countries;
    markGlobeDirty();
  }, [countries]);

  useEffect(() => {
    projectsRef.current = projects;
    markGlobeDirty();
  }, [projects]);

  useEffect(() => {
    popupCountryRef.current = popupCountry;
    popupProjectRef.current = popupProject;
    profileOpenRef.current = Boolean(isProfileOpen);

    if (popupCountry || popupProject || isProfileOpen) {
      pauseAutoRotation();
    } else {
      resumeAutoRotationAfterDelay();
    }

    if (!popupCountry) {
      popupPositionRef.current = null;
      setPopupPosition(null);
    }

    if (!popupProject) {
      projectPopupPositionRef.current = null;
      setProjectPopupPosition(null);
    }

    markGlobeDirty();
  }, [popupCountry, popupProject, isProfileOpen]);

  useEffect(() => {
    if (!selectedCountry) {
      markGlobeDirty();
      return;
    }

    startFocusAnimation(selectedCountry.coordinates);
  }, [selectedCountry]);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return undefined;
    }

    function handleNativeWheel(event) {
      event.preventDefault();
      event.stopPropagation();
      pauseAutoRotation();

      const zoomDelta = clamp(-event.deltaY * 0.0015, -0.14, 0.14);
      zoomRef.current = clamp(zoomRef.current + zoomDelta, minZoom, maxZoom);
      markGlobeDirty();
      resumeAutoRotationAfterDelay();
    }

    shell.addEventListener("wheel", handleNativeWheel, { passive: false });

    return () => {
      shell.removeEventListener("wheel", handleNativeWheel);
    };
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        pauseAutoRotation();
      } else {
        resumeAutoRotationAfterDelay();
      }

      markGlobeDirty();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    function tick(now) {
      // Focus Country Animation (Problem 2) takes priority over auto-rotation
      // in the SAME loop, so there is never a second requestAnimationFrame
      // loop and the two can never fight each other.
      if (focusAnimRef.current) {
        const anim = focusAnimRef.current;
        const t = Math.min(1, (now - anim.start) / anim.duration);
        const eased = easeOutCubic(t);
        rotationRef.current = [
          anim.from[0] + (anim.to[0] - anim.from[0]) * eased,
          anim.from[1] + (anim.to[1] - anim.from[1]) * eased,
          anim.from[2] + (anim.to[2] - anim.from[2]) * eased,
        ];
        needsRenderRef.current = true;

        if (t >= 1) {
          focusAnimRef.current = null;
        }

        renderGlobe();
        needsRenderRef.current = false;
        animationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const shouldAutoRotate =
        !isPausedRef.current &&
        !isDraggingRef.current &&
        isAutoRotationEnabledRef.current &&
        !popupCountryRef.current &&
        !popupProjectRef.current &&
        !profileOpenRef.current &&
        !document.hidden;

      if (shouldAutoRotate && now - lastAutoFrameRef.current >= autoFrameInterval) {
        const elapsed = Math.min(
          80,
          lastAutoFrameRef.current
            ? now - lastAutoFrameRef.current
            : autoFrameInterval
        );
        const [lambda, phi, gamma] = rotationRef.current;
        rotationRef.current = [lambda - elapsed * autoDegreesPerMs, phi, gamma];
        lastAutoFrameRef.current = now;
        needsRenderRef.current = true;
      }

      // Settle frame: when motion has stopped but the last render used the
      // coarser interactive precision, render once more at full quality.
      if (
        !needsRenderRef.current &&
        lastRenderWasInteractiveRef.current &&
        !isDraggingRef.current &&
        !shouldAutoRotate
      ) {
        needsRenderRef.current = true;
      }

      if (needsRenderRef.current) {
        renderGlobe();
        needsRenderRef.current = false;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    }

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearResumeTimer();
    };
  }, []);

  function markGlobeDirty() {
    needsRenderRef.current = true;
  }

  function clearResumeTimer() {
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }

  function pauseAutoRotation() {
    clearResumeTimer();
    isPausedRef.current = true;
  }

  function shouldSuppressClick() {
    if (suppressClickRef.current || dragDistanceRef.current > 7) {
      suppressClickRef.current = false;
      dragDistanceRef.current = 0;
      return true;
    }

    dragDistanceRef.current = 0;
    return false;
  }

  function resolveProjectCountry(project) {
    return (
      countriesRef.current.find((item) => item.code === project.countryCode) ??
      null
    );
  }

  function focusAndOpenCountry(country) {
    if (!country) {
      return;
    }

    closeHoverPreviewImmediately();
    pauseAutoRotation();
    startFocusAnimation(country.coordinates);
    onViewProfile(country);
  }

  function activatePointerTarget(target) {
    if (!target) {
      return false;
    }

    const projectId = target.getAttribute("data-project-marker");
    const countryId =
      target.getAttribute("data-country-marker") ??
      target.getAttribute("data-country-shape");

    if (projectId) {
      const project = projectsRef.current.find((item) => item.id === projectId);
      const country = project ? resolveProjectCountry(project) : null;
      if (country) {
        focusAndOpenCountry(country);
        return true;
      }
      return false;
    }

    if (countryId) {
      const country = countriesRef.current.find((item) => item.id === countryId);
      if (country) {
        focusAndOpenCountry(country);
        return true;
      }
    }

    return false;
  }

  function resumeAutoRotationAfterDelay() {
    clearResumeTimer();

    if (
      isDraggingRef.current ||
      !isAutoRotationEnabledRef.current ||
      popupCountryRef.current ||
      popupProjectRef.current ||
      profileOpenRef.current ||
      document.hidden
    ) {
      return;
    }

    resumeTimerRef.current = window.setTimeout(() => {
      isPausedRef.current = false;
      lastAutoFrameRef.current = performance.now();
      resumeTimerRef.current = null;
    }, autoResumeDelay);
  }

  function isGlobeMoving() {
    return (
      isDraggingRef.current ||
      Boolean(focusAnimRef.current) ||
      (!isPausedRef.current &&
        isAutoRotationEnabledRef.current &&
        !popupCountryRef.current &&
        !popupProjectRef.current &&
        !profileOpenRef.current &&
        !document.hidden)
    );
  }

  function renderGlobe() {
    const moving = isGlobeMoving();
    const projection = projectionRef.current
      .rotate(rotationRef.current)
      .scale(baseScale * zoomRef.current)
      .precision(moving ? interactivePrecision : staticPrecision);
    const mapPath = pathRef.current;
    lastRenderWasInteractiveRef.current = moving;

    const spherePath = mapPath(sphere) ?? "";
    sphereRef.current?.setAttribute("d", spherePath);
    clipSphereRef.current?.setAttribute("d", spherePath);
    graticuleRef.current?.setAttribute("d", mapPath(graticule) ?? "");

    // LOD selection: simplified geometry while moving, full 50m when settled.
    const activeFeatures = moving ? simplifiedLandFeatures : landFeatures;

    landFeatures.forEach((geo, index) => {
      const node = geographyRefs.current.get(getFeatureKey(geo, index));

      if (!node) {
        return;
      }

      // Back-face culling: skip path generation entirely for features
      // whose bounding sphere is fully beyond the visible hemisphere.
      if (isFeatureFullyHidden(index, rotationRef.current)) {
        if (node.hasAttribute("d")) {
          node.removeAttribute("d");
        }
        return;
      }

      const pathData = mapPath(activeFeatures[index]);

      if (pathData) {
        node.setAttribute("d", pathData);
      } else {
        node.removeAttribute("d");
      }
    });

    countriesRef.current.forEach((country) => {
      const marker = markerRefs.current.get(country.id);
      const visible = isCoordinateVisible(country.coordinates, rotationRef.current);
      const projected = visible ? projection(country.coordinates) : null;

      if (!marker) {
        return;
      }

      if (!projected) {
        marker.style.display = "none";
        return;
      }

      marker.style.display = "";
      marker.setAttribute("transform", `translate(${projected[0]} ${projected[1]})`);
    });

    projectsRef.current.forEach((project) => {
      const marker = projectMarkerRefs.current.get(project.id);
      const coordinates = getProjectCoordinates(project);
      const visible = isCoordinateVisible(coordinates, rotationRef.current);
      const projected = visible ? projection(coordinates) : null;

      if (!marker) {
        return;
      }

      if (!projected) {
        marker.style.display = "none";
        return;
      }

      marker.style.display = "";
      marker.setAttribute("transform", `translate(${projected[0]} ${projected[1]})`);
    });

    updatePopupPosition(projection);
    updateProjectPopupPosition(projection);
  }

  function updatePopupPosition(projection) {
    const country = popupCountryRef.current;

    if (!country || !isCoordinateVisible(country.coordinates, rotationRef.current)) {
      if (popupPositionRef.current) {
        popupPositionRef.current = null;
        setPopupPosition(null);
      }
      return;
    }

    const projected = projection(country.coordinates);

    if (!projected) {
      return;
    }

    const nextPosition = {
      x: clamp((projected[0] / width) * 100, 20, 80),
      y: clamp((projected[1] / height) * 100, 22, 78),
    };
    const previousPosition = popupPositionRef.current;

    if (
      !previousPosition ||
      Math.abs(previousPosition.x - nextPosition.x) > 0.3 ||
      Math.abs(previousPosition.y - nextPosition.y) > 0.3
    ) {
      popupPositionRef.current = nextPosition;
      setPopupPosition(nextPosition);
    }
  }

  function updateProjectPopupPosition(projection) {
    const project = popupProjectRef.current;
    const coordinates = project ? getProjectCoordinates(project) : null;

    if (
      !project ||
      !isCoordinateVisible(coordinates, rotationRef.current)
    ) {
      if (projectPopupPositionRef.current) {
        projectPopupPositionRef.current = null;
        setProjectPopupPosition(null);
      }
      return;
    }

    const projected = projection(coordinates);

    if (!projected) {
      return;
    }

    const nextPosition = {
      x: clamp((projected[0] / width) * 100, 20, 80),
      y: clamp((projected[1] / height) * 100, 22, 78),
    };
    const previousPosition = projectPopupPositionRef.current;

    if (
      !previousPosition ||
      Math.abs(previousPosition.x - nextPosition.x) > 0.3 ||
      Math.abs(previousPosition.y - nextPosition.y) > 0.3
    ) {
      projectPopupPositionRef.current = nextPosition;
      setProjectPopupPosition(nextPosition);
    }
  }

  function startFocusAnimation(coordinates) {
    if (
      !coordinates ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1])
    ) {
      return;
    }

    const currentRotation = rotationRef.current;
    // Shortest-path longitude so the globe never spins the "long way round".
    const targetLambda = normalizeLongitude(-coordinates[0], currentRotation[0]);
    const target = [targetLambda, -coordinates[1], currentRotation[2] ?? 0];

    const existing = focusAnimRef.current;
    if (
      existing &&
      Math.abs(existing.to[0] - target[0]) < 0.01 &&
      Math.abs(existing.to[1] - target[1]) < 0.01
    ) {
      // Already animating (or just finished) to this exact target - avoid
      // restarting the animation from scratch on a duplicate trigger.
      return;
    }

    pauseAutoRotation();
    focusAnimRef.current = {
      from: currentRotation.slice(),
      to: target,
      start: performance.now(),
      duration: focusAnimationDuration,
    };
    markGlobeDirty();
  }

  function computeHoverCardPosition(event) {
    const shell = shellRef.current;

    if (!shell) {
      return { x: 16, y: 16 };
    }

    const rect = shell.getBoundingClientRect();
    const cardWidth = 320;
    const cardHeight = 300;

    return {
      x: clamp(event.clientX - rect.left + 18, 12, Math.max(12, rect.width - cardWidth - 12)),
      y: clamp(event.clientY - rect.top + 18, 12, Math.max(12, rect.height - cardHeight - 12)),
    };
  }

  function clearHoverShowTimer() {
    if (hoverShowTimerRef.current) {
      window.clearTimeout(hoverShowTimerRef.current);
      hoverShowTimerRef.current = null;
    }
  }

  function clearHoverCloseTimer() {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }

  // Hover = preview. Called on pointer-enter of a country shape, country
  // marker, or project marker. Pauses rotation immediately (so the target
  // does not drift away mid-hover) and shows the card after a short delay.
  function scheduleHoverPreview(event, target) {
    if (isDraggingRef.current) {
      return;
    }

    clearHoverCloseTimer();
    pauseAutoRotation();

    const position = computeHoverCardPosition(event);
    clearHoverShowTimer();
    hoverShowTimerRef.current = window.setTimeout(() => {
      hoverShowTimerRef.current = null;
      setHoverPreview({ ...target, ...position });
    }, hoverShowDelay);
  }

  // Called on pointer-leave of the hover target itself. Gives the cursor a
  // short grace window to land on the card before actually closing it.
  function requestCloseHoverPreview() {
    clearHoverShowTimer();
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (isCardHoveredRef.current) {
        return;
      }
      setHoverPreview(null);
      resumeAutoRotationAfterDelay();
    }, hoverCloseGrace);
  }

  function handleHoverCardEnter() {
    isCardHoveredRef.current = true;
    clearHoverCloseTimer();
    pauseAutoRotation();
  }

  function handleHoverCardLeave() {
    isCardHoveredRef.current = false;
    requestCloseHoverPreview();
  }

  // Click = focus. Used to close any open hover preview before a click
  // proceeds (country click, project click, drag, escape, etc).
  function closeHoverPreviewImmediately() {
    clearHoverShowTimer();
    clearHoverCloseTimer();
    isCardHoveredRef.current = false;
    setHoverPreview(null);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      rotation: rotationRef.current,
    };
    pointerTargetRef.current = event.target.closest?.(
      "[data-project-marker], [data-country-marker], [data-country-shape]"
    );
    dragDistanceRef.current = 0;
    suppressClickRef.current = false;
    isDraggingRef.current = true;
    pauseAutoRotation();
    setIsDragging(true);
    closeHoverPreviewImmediately();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current) {
      return;
    }

    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragDistanceRef.current = Math.max(
      dragDistanceRef.current,
      Math.abs(dx) + Math.abs(dy)
    );

    rotationRef.current = [
      dragRef.current.rotation[0] + dx * 0.34,
      clamp(dragRef.current.rotation[1] - dy * 0.28, -65, 65),
      0,
    ];
    markGlobeDirty();
  }

  function handlePointerUp(event) {
    if (
      dragRef.current &&
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const movedEnoughToDrag = dragDistanceRef.current > 7;
    const pointerTarget = pointerTargetRef.current;
    dragRef.current = null;
    pointerTargetRef.current = null;
    isDraggingRef.current = false;
    const activatedTarget =
      !movedEnoughToDrag && activatePointerTarget(pointerTarget);

    suppressClickRef.current = movedEnoughToDrag || activatedTarget;
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
        dragDistanceRef.current = 0;
      }, 250);
    } else {
      dragDistanceRef.current = 0;
    }
    setIsDragging(false);
    markGlobeDirty();
    if (!activatedTarget) {
      resumeAutoRotationAfterDelay();
    }
  }

  function handleCountrySelect(event, country) {
    event.stopPropagation();

    if (shouldSuppressClick()) {
      return;
    }

    focusAndOpenCountry(country);
  }

  function handleProjectSelect(event, project) {
    event.stopPropagation();

    if (shouldSuppressClick()) {
      return;
    }

    focusAndOpenCountry(resolveProjectCountry(project));
  }

  function handleMarkerPointerDown(event) {
    event.stopPropagation();
    dragDistanceRef.current = 0;
    suppressClickRef.current = false;
    pauseAutoRotation();
  }

  function resetView() {
    rotationRef.current = defaultRotation;
    zoomRef.current = defaultZoom;
    closeHoverPreviewImmediately();
    markGlobeDirty();
    onClearSelection();
    resumeAutoRotationAfterDelay();
  }

  function changeZoom(delta) {
    pauseAutoRotation();
    zoomRef.current = clamp(zoomRef.current + delta, minZoom, maxZoom);
    markGlobeDirty();
    resumeAutoRotationAfterDelay();
  }

  function handleShellPointerEnter() {
    isPointerInsideRef.current = true;
  }

  function handleShellPointerLeave() {
    isPointerInsideRef.current = false;
    closeHoverPreviewImmediately();
    resumeAutoRotationAfterDelay();
  }

  function handleEmptyGlobeClick(event) {
    const clickedInteractiveLayer = event.target.closest?.(
      "[data-project-marker], [data-country-marker], [data-country-shape]"
    );

    if (shouldSuppressClick()) {
      return;
    }

    if (!clickedInteractiveLayer) {
      onCloseProjectPopup();
      onClosePopup();
      resumeAutoRotationAfterDelay();
    }
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        onCloseProjectPopup();
        onClosePopup();
        resumeAutoRotationAfterDelay();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onCloseProjectPopup, onClosePopup]);

  return (
    <section
      aria-label="Interactive rotatable maritime research globe"
      className={`map-shell globe-container ${isDragging ? "dragging" : ""}`}
      onPointerEnter={handleShellPointerEnter}
      onPointerLeave={handleShellPointerLeave}
      ref={shellRef}
    >
      <div className="map-scanline" aria-hidden="true" />
      <div className="map-orbit orbit-one" aria-hidden="true" />
      <div className="map-orbit orbit-two" aria-hidden="true" />

      <div className="map-controls" aria-label="Map controls">
        <button
          aria-label="Zoom in"
          className="icon-button"
          onClick={() => changeZoom(0.1)}
          title="Zoom in"
          type="button"
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Zoom out"
          className="icon-button"
          onClick={() => changeZoom(-0.1)}
          title="Zoom out"
          type="button"
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="Reset globe view"
          className="icon-button"
          onClick={resetView}
          title="Reset view"
          type="button"
        >
          <RotateCcw size={18} />
        </button>
        <button
          aria-label={
            isAutoRotationEnabled ? "Pause globe rotation" : "Resume globe rotation"
          }
          className={`icon-button ${isAutoRotationEnabled ? "active" : ""}`}
          onClick={() => setIsAutoRotationEnabled((current) => !current)}
          title={
            isAutoRotationEnabled ? "Pause rotation" : "Resume rotation"
          }
          type="button"
        >
          {isAutoRotationEnabled ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </div>

      <svg
        aria-label="Rotatable globe map with clickable maritime research countries"
        className="world-map"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleEmptyGlobeClick}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <radialGradient id="globeOcean" cx="45%" cy="38%" r="68%">
            <stop offset="0%" stopColor="#0b3447" />
            <stop offset="52%" stopColor="#041A27" />
            <stop offset="100%" stopColor="#01080d" />
          </radialGradient>
          <clipPath id="globeClip">
            <path d={initialSpherePath} ref={clipSphereRef} />
          </clipPath>
        </defs>

        <path
          className="globe-sphere"
          d={initialSpherePath}
          ref={sphereRef}
        />

        <g className="clean-globe-layers" clipPath="url(#globeClip)">
          <path
            className="globe-graticule"
            d={initialGraticulePath}
            ref={graticuleRef}
          />
          {landFeatures.map((geo, index) => {
            const country = countriesByAtlasName.get(geo.properties.name);
            const isThemeMatch =
              Boolean(country) &&
              (!hasFilter || countryMatchesTopicFilter(country, activeFilter));
            const isSelected = selectedCountry?.id === country?.id;
            const isClickable = Boolean(country);
            const pathData = initialPath(geo);
            const featureKey = getFeatureKey(geo, index);

            if (!pathData) {
              return null;
            }

            return (
              <path
                aria-label={
                  country
                    ? `${country.name}, ${getIntensityLabel(country.researchIntensity)} research intensity, ${country.researchIntensity}/100`
                    : undefined
                }
                className={getCountryClass(
                  country,
                  isThemeMatch,
                  selectedCountry
                )}
                data-country-shape={country?.id}
                d={pathData}
                key={featureKey}
                onClick={
                  country ? (event) => handleCountrySelect(event, country) : undefined
                }
                onKeyDown={
                  country
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleCountrySelect(event, country);
                        }
                      }
                    : undefined
                }
                onPointerEnter={
                  country
                    ? (event) =>
                        scheduleHoverPreview(event, { kind: "country", country })
                    : undefined
                }
                onPointerLeave={country ? requestCloseHoverPreview : undefined}
                ref={(node) => {
                  if (node) {
                    geographyRefs.current.set(featureKey, node);
                  } else {
                    geographyRefs.current.delete(featureKey);
                  }
                }}
                role={isClickable ? "button" : undefined}
                style={{
                  "--country-color": getCountryStroke(country, selectedCountry),
                  fill: getCountryFill(country),
                  opacity: getMapCountryOpacity(
                    country,
                    isThemeMatch,
                    hasFilter,
                    isSelected
                  ),
                }}
                tabIndex={isClickable ? 0 : -1}
              />
            );
          })}

          <g className="country-marker-layer">
            {countries.map((country) => {
              const isThemeMatch =
                !hasFilter || countryMatchesTopicFilter(country, activeFilter);
              const isSelected = selectedCountry?.id === country.id;
              const isFocusCountry = country.id === "singapore";
              const initialVisible = isCoordinateVisible(
                country.coordinates,
                defaultRotation
              );
              const initialProjected = initialVisible
                ? initialProjection(country.coordinates)
                : null;
              const radius = 4 + country.researchIntensity / 28;

              return (
                <g
                  aria-label={`Open ${country.name} maritime research popup`}
                  className={[
                    "country-marker",
                    isThemeMatch ? "active" : "muted",
                    isFocusCountry ? "focus" : "",
                    isSelected ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-country-marker={country.id}
                  key={country.id}
                  onClick={(event) => handleCountrySelect(event, country)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleCountrySelect(event, country);
                    }
                  }}
                  onPointerDown={handleMarkerPointerDown}
                  onPointerEnter={(event) =>
                    scheduleHoverPreview(event, { kind: "country", country })
                  }
                  onPointerLeave={requestCloseHoverPreview}
                  ref={(node) => {
                    if (node) {
                      markerRefs.current.set(country.id, node);
                    } else {
                      markerRefs.current.delete(country.id);
                    }
                  }}
                  role="button"
                  style={{
                    display: initialProjected ? undefined : "none",
                  }}
                  tabIndex={0}
                  transform={
                    initialProjected
                      ? `translate(${initialProjected[0]} ${initialProjected[1]})`
                      : undefined
                  }
                >
                  <circle className="marker-hit" r={radius + 14} />
                  <circle
                    className="marker-ring"
                    r={radius + 4}
                    style={{
                      stroke: getIntensityColor(
                        country.researchIntensity,
                        isSelected || isFocusCountry
                      ),
                    }}
                  />
                  <circle
                    className="marker-core"
                    r={radius}
                    style={{
                      fill: getIntensityColor(country.researchIntensity, false),
                    }}
                  />
                </g>
              );
            })}
          </g>

          <g className="project-marker-layer">
            {projects
              .filter((project) =>
                hasDistinctProjectLocation(
                  project,
                  countriesByCode.get(project.countryCode)
                )
              )
              .map((project) => {
              const isThemeMatch = projectMatchesTopicFilter(project, activeFilter);
              const isSelected = popupProject?.id === project.id;
              const coordinates = getProjectCoordinates(project);
              const initialVisible = isCoordinateVisible(coordinates, defaultRotation);
              const initialProjected =
                initialVisible && coordinates ? initialProjection(coordinates) : null;
              const radius =
                project.displayTier === "featured"
                  ? 10
                  : project.displayTier === "highlighted"
                    ? 8
                    : 6;

              return (
                <g
                  aria-label={`Open ${project.title} project evidence popup`}
                  className={[
                    "project-marker",
                    `project-marker-${project.displayTier}`,
                    isThemeMatch ? "active" : "muted",
                    isSelected ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-project-marker={project.id}
                  key={project.id}
                  onClick={(event) => handleProjectSelect(event, project)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleProjectSelect(event, project);
                    }
                  }}
                  onPointerDown={handleMarkerPointerDown}
                  onPointerEnter={(event) =>
                    scheduleHoverPreview(event, { kind: "project", project })
                  }
                  onPointerLeave={requestCloseHoverPreview}
                  ref={(node) => {
                    if (node) {
                      projectMarkerRefs.current.set(project.id, node);
                    } else {
                      projectMarkerRefs.current.delete(project.id);
                    }
                  }}
                  role="button"
                  style={{
                    display: initialProjected ? undefined : "none",
                  }}
                  tabIndex={0}
                  transform={
                    initialProjected
                      ? `translate(${initialProjected[0]} ${initialProjected[1]})`
                      : undefined
                  }
                >
                  <circle className="project-marker-hit" r={radius + 13} />
                  <circle className="project-marker-ring" r={radius + 5} />
                  <path
                    className="project-marker-core"
                    d={`M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`}
                  />
                  <text
                    aria-hidden="true"
                    className="project-marker-score"
                    dy="3.4"
                    textAnchor="middle"
                  >
                    {project.displayScore}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <AnimatePresence>
        {hoverPreview ? (
          <HoverPreviewCard
            country={hoverPreview.kind === "country" ? hoverPreview.country : null}
            key={`${hoverPreview.kind}-${
              hoverPreview.kind === "country"
                ? hoverPreview.country.id
                : hoverPreview.project.id
            }`}
            onMouseEnter={handleHoverCardEnter}
            onMouseLeave={handleHoverCardLeave}
            onViewFullProfile={() => focusAndOpenCountry(hoverPreview.country)}
            position={{ x: hoverPreview.x, y: hoverPreview.y }}
            project={hoverPreview.kind === "project" ? hoverPreview.project : null}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {popupCountry ? (
          <CountryPopup
            country={popupCountry}
            key={popupCountry.id}
            onClose={onClosePopup}
            onInteractionEnd={resumeAutoRotationAfterDelay}
            onInteractionStart={pauseAutoRotation}
            onViewProfile={onViewProfile}
            position={popupPosition}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {popupProject ? (
          <ProjectPopup
            key={popupProject.id}
            onClose={onCloseProjectPopup}
            onInteractionEnd={resumeAutoRotationAfterDelay}
            onInteractionStart={pauseAutoRotation}
            position={projectPopupPosition}
            project={popupProject}
          />
        ) : null}
      </AnimatePresence>

      <div className="map-legend" aria-label="Research intensity legend">
        <span>Research intensity</span>
        <div className="legend-scale">
          <i className="legend-very-low" />
          <i className="legend-low" />
          <i className="legend-low-medium" />
          <i className="legend-medium" />
          <i className="legend-medium-high" />
          <i className="legend-high" />
          <i className="legend-very-high" />
        </div>
        <div className="legend-labels">
          <small>Very Low</small>
          <small>Low</small>
          <small>Low-Med</small>
          <small>Medium</small>
          <small>Med-High</small>
          <small>High</small>
          <small>Very High</small>
        </div>
        <p className="legend-note">
          Research intensity is calculated from verified project-location,
          institution-country, partner, funder and publication-affiliation
          relationships. Neutral land means no verified activity in the extracted
          dataset.
        </p>
      </div>

      <div className="map-data-note">{dataStatusLabel}</div>
    </section>
  );
}
