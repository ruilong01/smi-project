import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoDistance,
  geoGraticule,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import { feature } from "topojson-client";
import worldMap from "world-atlas/countries-50m.json";
import { AnimatePresence } from "framer-motion";
import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import CountryPopup from "./CountryPopup.jsx";
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
const graticule = geoGraticule().step([20, 20])();
const sphere = { type: "Sphere" };
const autoResumeDelay = 4000;
const autoFrameInterval = 33;
const autoDegreesPerMs = 0.0011;

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

function getProjectCoordinates(project) {
  if (!Number.isFinite(project.longitude) || !Number.isFinite(project.latitude)) {
    return null;
  }

  return [project.longitude, project.latitude];
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
const initialPath = geoPath(initialProjection);
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
  const tooltipRef = useRef(null);
  const projectionRef = useRef(createProjection());
  const pathRef = useRef(geoPath(projectionRef.current));
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
  const [isDragging, setIsDragging] = useState(false);
  const [isAutoRotationEnabled, setIsAutoRotationEnabled] = useState(true);
  const [tooltipCountry, setTooltipCountry] = useState(null);
  const [popupPosition, setPopupPosition] = useState(null);
  const [projectPopupPosition, setProjectPopupPosition] = useState(null);
  const hasFilter = activeFilter !== "All";

  const countriesByAtlasName = useMemo(() => {
    return new Map(countries.map((country) => [country.atlasName, country]));
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

    pauseAutoRotation();
    rotationRef.current = [
      -selectedCountry.coordinates[0],
      -selectedCountry.coordinates[1],
      0,
    ];
    markGlobeDirty();
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
      if (project) {
        hideTooltip();
        pauseAutoRotation();
        onProjectClick(project);
        return true;
      }
    }

    if (countryId) {
      const country = countriesRef.current.find((item) => item.id === countryId);
      if (country) {
        hideTooltip();
        pauseAutoRotation();
        onCountryClick(country);
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

  function renderGlobe() {
    const projection = projectionRef.current
      .rotate(rotationRef.current)
      .scale(baseScale * zoomRef.current);
    const mapPath = pathRef.current;

    const spherePath = mapPath(sphere) ?? "";
    sphereRef.current?.setAttribute("d", spherePath);
    clipSphereRef.current?.setAttribute("d", spherePath);
    graticuleRef.current?.setAttribute("d", mapPath(graticule) ?? "");

    landFeatures.forEach((geo, index) => {
      const node = geographyRefs.current.get(getFeatureKey(geo, index));
      const pathData = mapPath(geo);

      if (!node) {
        return;
      }

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

  function updateTooltipPosition(event) {
    if (!shellRef.current || !tooltipRef.current) {
      return;
    }

    const rect = shellRef.current.getBoundingClientRect();
    tooltipRef.current.style.left = `${event.clientX - rect.left}px`;
    tooltipRef.current.style.top = `${event.clientY - rect.top}px`;
  }

  function showTooltip(event, country) {
    pauseAutoRotation();
    setTooltipCountry((currentCountry) =>
      currentCountry?.id === country.id ? currentCountry : country
    );

    window.requestAnimationFrame(() => updateTooltipPosition(event));
  }

  function hideTooltip() {
    setTooltipCountry(null);
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
    hideTooltip();
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

    hideTooltip();
    pauseAutoRotation();
    onCountryClick(country);
  }

  function handleProjectSelect(event, project) {
    event.stopPropagation();

    if (shouldSuppressClick()) {
      return;
    }

    hideTooltip();
    pauseAutoRotation();
    onProjectClick(project);
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
    hideTooltip();
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
    hideTooltip();
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
                  country ? (event) => showTooltip(event, country) : undefined
                }
                onPointerLeave={country ? hideTooltip : undefined}
                onPointerMove={
                  country ? (event) => updateTooltipPosition(event) : undefined
                }
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
                  onPointerEnter={(event) => showTooltip(event, country)}
                  onPointerLeave={hideTooltip}
                  onPointerMove={(event) => updateTooltipPosition(event)}
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
                  <circle className="marker-hit" r={radius + 9} />
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
            {projects.map((project) => {
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
                  onPointerEnter={pauseAutoRotation}
                  onPointerLeave={resumeAutoRotationAfterDelay}
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
                  <circle className="project-marker-hit" r={radius + 11} />
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

      {tooltipCountry ? (
        <div className="map-tooltip" ref={tooltipRef}>
          <strong>{tooltipCountry.name}</strong>
          <small>
            Verified projects: {tooltipCountry.activity?.verifiedProjects ?? 0}
          </small>
          <small>
            Lead projects: {tooltipCountry.activity?.leadProjects ?? 0} / Partner
            projects: {tooltipCountry.activity?.partnerProjects ?? 0}
          </small>
          <small>
            Institutions: {tooltipCountry.activity?.institutions ?? tooltipCountry.institutions?.length ?? 0} /
            Publications: {tooltipCountry.activity?.publications ?? 0}
          </small>
          <small>
            Activity score: {tooltipCountry.activity?.activityScore ?? 0} /{" "}
            {getIntensityLabel(tooltipCountry.researchIntensity)}
          </small>
          <em>Last updated: {tooltipCountry.activity?.lastUpdated ?? tooltipCountry.dataUpdatedUntil}</em>
        </div>
      ) : null}

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
