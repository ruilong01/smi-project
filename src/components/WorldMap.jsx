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
  TERRAIN_GRADIENT_DEFS,
} from "../utils/intensity.js";

const width = 960;
const height = 620;
const defaultRotation = [-18, -16, 0];
const baseScale = 286;
const defaultZoom = 1;
const minZoom = 0.7;
// Deep zoom (Phase 1): high enough that a large country (China, US,
// Australia, Russia...) can fill the viewport. No province/admin-1 data
// exists to show at this depth (see intensity.js coverage notes) - this
// only affects how close the country-level shape itself can get.
const maxZoom = 7;
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
const restoreAnimationDuration = 800;
// Focus zoom stays modest (1.25-1.6x) so the country's context on the
// globe is still legible, not a disorienting close-up.
const focusZoomMultiplier = 1.35;
// Absolute floor for the focused zoom target, so a country click always
// zooms in meaningfully even if the user's current view is zoomed far out.
const focusMinZoom = 2.4;
// Shifts the focused country left, off the area the right-hand profile
// panel covers (see .country-profile-panel in index.css).
const focusTranslateShift = width * 0.07;

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
  projects = [],
  dataStatusLabel,
  selectedCountry,
  isProfileOpen,
  onClearSelection,
  onClosePopup,
  onCountryClick,
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
  const translateOffsetRef = useRef(0);
  // Country-focus mode machine ("global" | "focused" | "restoring") plus the
  // map view captured at the moment focus mode was entered, so "Go Back to
  // Map" can restore rotation/zoom exactly rather than jumping to default.
  const mapModeRef = useRef("global");
  const previousViewRef = useRef(null);
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
  const popupPositionRef = useRef(null);
  const profileOpenRef = useRef(Boolean(isProfileOpen));
  const countriesRef = useRef(countries);
  const projectsRef = useRef(projects);
  // Hover preview (Problem 1) and focus animation (Problem 2) state, kept
  // in refs so hover itself never drives a per-frame re-render.
  const hoverShowTimerRef = useRef(null);
  const hoverCloseTimerRef = useRef(null);
  const isCardHoveredRef = useRef(false);
  const viewAnimRef = useRef(null);
  const [hoverPreview, setHoverPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAutoRotationEnabled, setIsAutoRotationEnabled] = useState(true);
  const [popupPosition, setPopupPosition] = useState(null);
  const hasFilter = activeFilter !== "All";

  const countriesByAtlasName = useMemo(() => {
    return new Map(countries.map((country) => [country.atlasName, country]));
  }, [countries]);

  const countriesByCode = useMemo(() => {
    return new Map(countries.map((country) => [country.code, country]));
  }, [countries]);

  // Filters out projects with no distinct location (see
  // hasDistinctProjectLocation above) so they don't get a redundant marker
  // stacked on their country's own marker. Memoized because WorldMap
  // re-renders on every hover/drag/popup state change, not just when
  // `projects` itself changes.
  const visibleProjects = useMemo(() => {
    return projects.filter((project) =>
      hasDistinctProjectLocation(project, countriesByCode.get(project.countryCode))
    );
  }, [projects, countriesByCode]);

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
    profileOpenRef.current = Boolean(isProfileOpen);

    if (popupCountry || isProfileOpen) {
      pauseAutoRotation();
    } else {
      resumeAutoRotationAfterDelay();
    }

    if (!popupCountry) {
      popupPositionRef.current = null;
      setPopupPosition(null);
    }

    markGlobeDirty();
  }, [popupCountry, isProfileOpen]);

  useEffect(() => {
    if (selectedCountry) {
      startFocusAnimation(selectedCountry.coordinates);
      return;
    }

    if (mapModeRef.current === "focused" || mapModeRef.current === "restoring") {
      startRestoreAnimation();
    } else {
      markGlobeDirty();
    }
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

      // Multiplicative step so zoom feels proportional across the much
      // wider min/max range (0.7x-7x) rather than crawling near the top.
      const zoomFactor = 1 + clamp(-event.deltaY * 0.0022, -0.16, 0.16);
      zoomRef.current = clamp(zoomRef.current * zoomFactor, minZoom, maxZoom);
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
      // Focus/restore view animation takes priority over auto-rotation in
      // the SAME loop, so there is never a second requestAnimationFrame loop
      // and the two can never fight each other.
      if (viewAnimRef.current) {
        const anim = viewAnimRef.current;
        const t = Math.min(1, (now - anim.start) / anim.duration);
        const eased = easeOutCubic(t);
        rotationRef.current = [
          anim.fromRotation[0] + (anim.toRotation[0] - anim.fromRotation[0]) * eased,
          anim.fromRotation[1] + (anim.toRotation[1] - anim.fromRotation[1]) * eased,
          anim.fromRotation[2] + (anim.toRotation[2] - anim.fromRotation[2]) * eased,
        ];
        zoomRef.current = anim.fromZoom + (anim.toZoom - anim.fromZoom) * eased;
        translateOffsetRef.current =
          anim.fromOffset + (anim.toOffset - anim.fromOffset) * eased;
        needsRenderRef.current = true;

        if (t >= 1) {
          const onComplete = anim.onComplete;
          viewAnimRef.current = null;
          onComplete?.();
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
      Boolean(viewAnimRef.current) ||
      (!isPausedRef.current &&
        isAutoRotationEnabledRef.current &&
        !popupCountryRef.current &&
        !profileOpenRef.current &&
        !document.hidden)
    );
  }

  function renderGlobe() {
    const moving = isGlobeMoving();
    const projection = projectionRef.current
      .rotate(rotationRef.current)
      .scale(baseScale * zoomRef.current)
      .translate([width / 2 - translateOffsetRef.current, height / 2])
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

  // Shared by focus and restore: interpolates rotation, zoom and the
  // panel-aware translate offset together in the one rAF loop above.
  // Overwriting viewAnimRef is the cancellation mechanism - there is no
  // separate cancelAnimationFrame call because both animations share the
  // same tick(), so the next frame simply picks up the new target.
  function animateView({ toRotation, toZoom, toOffset, duration, onComplete }) {
    viewAnimRef.current = {
      fromRotation: rotationRef.current.slice(),
      toRotation,
      fromZoom: zoomRef.current,
      toZoom,
      fromOffset: translateOffsetRef.current,
      toOffset,
      start: performance.now(),
      duration,
      onComplete,
    };
    markGlobeDirty();
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
    const targetRotation = [targetLambda, -coordinates[1], currentRotation[2] ?? 0];

    // Only capture the "before country focus" view the first time we enter
    // focus mode from the normal map - switching between countries (or
    // re-focusing mid-restore) must not clobber that saved view.
    if (mapModeRef.current === "global") {
      previousViewRef.current = {
        rotation: currentRotation.slice(),
        zoom: zoomRef.current,
      };
    }
    mapModeRef.current = "focused";

    const baselineZoom = previousViewRef.current?.zoom ?? zoomRef.current;
    const targetZoom = clamp(
      Math.max(baselineZoom * focusZoomMultiplier, focusMinZoom),
      minZoom,
      maxZoom
    );

    const existing = viewAnimRef.current;
    if (
      existing &&
      Math.abs(existing.toRotation[0] - targetRotation[0]) < 0.01 &&
      Math.abs(existing.toRotation[1] - targetRotation[1]) < 0.01 &&
      Math.abs(existing.toZoom - targetZoom) < 0.001
    ) {
      // Already animating (or just finished) to this exact target - avoid
      // restarting the animation from scratch on a duplicate trigger.
      return;
    }

    pauseAutoRotation();
    animateView({
      toRotation: targetRotation,
      toZoom: targetZoom,
      toOffset: focusTranslateShift,
      duration: focusAnimationDuration,
    });
  }

  // "Go Back to Map": animates rotation/zoom/offset back to the view saved
  // when focus mode was entered (falling back to the default global view if
  // none was saved), then clears focus state and resumes auto-rotation.
  function startRestoreAnimation() {
    const previous = previousViewRef.current;

    mapModeRef.current = "restoring";
    pauseAutoRotation();
    animateView({
      toRotation: previous ? previous.rotation : defaultRotation,
      toZoom: previous ? previous.zoom : defaultZoom,
      toOffset: 0,
      duration: restoreAnimationDuration,
      onComplete: () => {
        mapModeRef.current = "global";
        previousViewRef.current = null;
        resumeAutoRotationAfterDelay();
      },
    });
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
    viewAnimRef.current = null;
    mapModeRef.current = "global";
    previousViewRef.current = null;
    rotationRef.current = defaultRotation;
    zoomRef.current = defaultZoom;
    translateOffsetRef.current = 0;
    closeHoverPreviewImmediately();
    markGlobeDirty();
    onClearSelection();
    resumeAutoRotationAfterDelay();
  }

  function changeZoom(factor) {
    pauseAutoRotation();
    zoomRef.current = clamp(zoomRef.current * factor, minZoom, maxZoom);
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
      onClosePopup();
      resumeAutoRotationAfterDelay();
    }
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        onClosePopup();
        resumeAutoRotationAfterDelay();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClosePopup]);

  return (
    <section
      aria-label="Interactive rotatable maritime research globe"
      className={`map-shell globe-container ${isDragging ? "dragging" : ""}`}
      onPointerEnter={handleShellPointerEnter}
      onPointerLeave={handleShellPointerLeave}
      ref={shellRef}
    >
      <div className="map-scanline" aria-hidden="true" />
      <div className="map-starfield" aria-hidden="true" />

      <div className="map-controls" aria-label="Map controls">
        <button
          aria-label="Zoom in"
          className="icon-button"
          onClick={() => changeZoom(1.25)}
          title="Zoom in"
          type="button"
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Zoom out"
          className="icon-button"
          onClick={() => changeZoom(0.8)}
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
          <radialGradient id="globeOcean" cx="42%" cy="34%" r="72%">
            <stop offset="0%" stopColor="#0E3E52" />
            <stop offset="38%" stopColor="#0A2C3C" />
            <stop offset="70%" stopColor="#061E2F" />
            <stop offset="100%" stopColor="#020B12" />
          </radialGradient>
          {/* Terrain-feel land fills (Phase 2-lite): a raking-light gradient
              per intensity bucket, shared across every country in that
              bucket. Referenced by fill="url(#...)" - no per-country or
              per-frame cost over a flat colour fill. */}
          {TERRAIN_GRADIENT_DEFS.map(({ id, light, base }) => (
            <linearGradient id={id} key={id} x1="15%" y1="10%" x2="85%" y2="95%">
              <stop offset="0%" stopColor={light} />
              <stop offset="100%" stopColor={base} />
            </linearGradient>
          ))}
          {/* Limb-darkening vignette: cheap static overlay (one rect, one
              gradient, no per-frame recompute) that reads as sphere/terrain
              relief rather than a flat disc. */}
          <radialGradient id="globeVignette" cx="42%" cy="34%" r="72%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="78%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
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
            // initialPath is only ever evaluated at defaultRotation, purely
            // to paint something before the first live rAF frame. A feature
            // on the far side of the globe at that fixed default (e.g.
            // Japan/Australia are ~90-120deg from the Africa/Europe-centred
            // default) legitimately has no path THERE - but the <path>
            // element must still be created and ref-registered, or the live
            // per-frame renderer below has no node to ever update once the
            // user rotates that country into view. Do not `return null`
            // here: that would permanently drop the country from the globe.
            const pathData = initialPath(geo);
            const featureKey = getFeatureKey(geo, index);

            return (
              <path
                aria-label={
                  country
                    ? `${country.name}, ${getIntensityLabel(country.researchIntensity)} research intensity, ${country.researchIntensity}/100`
                    : `${geo.properties.name}, coverage pending - no extracted records yet`
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
                onPointerEnter={(event) =>
                  scheduleHoverPreview(
                    event,
                    country
                      ? { kind: "country", country }
                      : { kind: "coverage", name: geo.properties.name }
                  )
                }
                onPointerLeave={requestCloseHoverPreview}
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

          <rect
            aria-hidden="true"
            className="globe-vignette"
            fill="url(#globeVignette)"
            height={height}
            width={width}
          />

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
            {visibleProjects.map((project) => {
              const isThemeMatch = projectMatchesTopicFilter(project, activeFilter);
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
            coveragePendingName={
              hoverPreview.kind === "coverage" ? hoverPreview.name : null
            }
            country={hoverPreview.kind === "country" ? hoverPreview.country : null}
            key={`${hoverPreview.kind}-${
              hoverPreview.kind === "country"
                ? hoverPreview.country.id
                : hoverPreview.kind === "project"
                  ? hoverPreview.project.id
                  : hoverPreview.name
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

      <div className="map-legend" aria-label="Research intensity legend">
        <span>Research intensity</span>
        <div className="legend-scale">
          <i className="legend-coverage-pending" />
          <i className="legend-very-low" />
          <i className="legend-low" />
          <i className="legend-low-medium" />
          <i className="legend-medium" />
          <i className="legend-medium-high" />
          <i className="legend-high" />
          <i className="legend-very-high" />
        </div>
        <div className="legend-labels">
          <small>Coverage pending</small>
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
          relationships in the current dataset.
        </p>
        <p className="legend-note legend-note-emphasis">
          <strong>Coverage pending</strong> does not mean no research
          activity. It means the current dataset has not yet verified
          extracted records for that country.
        </p>
      </div>

      <div className="map-data-note">
        <p>{dataStatusLabel}</p>
        <p className="map-data-note-caption">
          {countries.length} countries with verified records, {projects.length}{" "}
          extracted records. Map reflects extracted records in the current
          dataset, not a complete global ranking.
        </p>
      </div>
    </section>
  );
}
