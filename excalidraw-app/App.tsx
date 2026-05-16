import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  THEME,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiFileText,
  FiGrid,
  FiList,
  FiMenu,
  FiPlus,
  FiSettings,
} from "react-icons/fi";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  ExcalLogo,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import {
  CloudStorageError,
  CLOUD_DRAFTS_PATH,
  CLOUD_SETTINGS_PATH,
  createAndOpenRemoteProject,
  createRemoteProject,
  deleteRemoteProject,
  getCloudProjectId,
  getRemoteAuthSession,
  getRemoteProjectMetadata,
  importFromRemoteStorage,
  listRemoteProjects,
  RemoteData,
  saveRemoteProjectTitle,
} from "./data/cloud/RemoteData";
import { getCloudLoginUrl } from "./data/cloud/config";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

// import { ExcalidrawPlusPromoBanner } from "./components/ExcalidrawPlusPromoBanner";
import { AppSidebar } from "./components/AppSidebar";

import type { CollabAPI } from "./collab/Collab";

const isRemoteStorageEnabled =
  import.meta.env.VITE_APP_REMOTE_STORAGE === "true";
const DataStorage = isRemoteStorageEnabled ? RemoteData : LocalData;
const CLOUD_PROJECT_VIEW_STORAGE_KEY = "sacred-draw-cloud-project-view";

const CloudProjectsHome = () => {
  const [authStatus, setAuthStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getRemoteAuthSession()
      .then((session) => {
        if (cancelled) {
          return;
        }

        if (session.authenticated) {
          setAuthStatus("authenticated");
          return;
        }

        setAuthStatus("unauthenticated");
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setAuthStatus("unauthenticated");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const createProject = async () => {
    const projectId = window.crypto.randomUUID();

    setIsCreating(true);
    setError(null);

    try {
      const session = await getRemoteAuthSession();

      if (!session.authenticated) {
        window.location.assign(getCloudLoginUrl(CLOUD_DRAFTS_PATH));
        return;
      }

      await createRemoteProject(projectId);
      window.location.assign(`${CLOUD_DRAFTS_PATH}/${projectId}`);
    } catch (error) {
      console.error(error);
      setError(
        error instanceof CloudStorageError
          ? error.message
          : "No se pudo crear el proyecto. Verifica la sesión y la API.",
      );
      setIsCreating(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f8f6f2",
        color: "#1f1f1f",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 24,
      }}
    >
      <main
        style={{
          width: "min(560px, 100%)",
          padding: 32,
          border: "1px solid #ded9cf",
          borderRadius: 20,
          background: "#fffdf8",
          boxShadow: "0 24px 80px rgba(31, 31, 31, 0.08)",
          textAlign: "center",
        }}
      >
        <div style={{ width: 72, margin: "0 auto 20px" }}>{ExcalLogo}</div>
        <h1 style={{ fontSize: 34, lineHeight: 1.1, margin: "0 0 12px" }}>
          Sacred Draw
        </h1>
        {authStatus !== "loading" ? (
          <>
            <p style={{ fontSize: 16, margin: "0 0 28px", color: "#5f5a52" }}>
              {authStatus === "authenticated"
                ? "Continúa trabajando en tus drafts guardados en la nube."
                : "Crea un proyecto nuevo para guardar tu board en la nube con una URL única."}
            </p>
            <button
              type="button"
              onClick={() => {
                if (authStatus === "authenticated") {
                  window.location.assign(CLOUD_DRAFTS_PATH);
                  return;
                }

                createProject();
              }}
              disabled={authStatus !== "authenticated" && isCreating}
              style={{
                border: 0,
                borderRadius: 12,
                background: "#1f1f1f",
                color: "#fff",
                cursor:
                  authStatus !== "authenticated" && isCreating
                    ? "default"
                    : "pointer",
                fontSize: 16,
                fontWeight: 700,
                padding: "14px 22px",
                opacity: authStatus !== "authenticated" && isCreating ? 0.7 : 1,
              }}
            >
              {authStatus === "authenticated"
                ? "Dashboard"
                : isCreating
                  ? "Creando..."
                  : "Crear nuevo"}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 16, margin: "0", color: "#5f5a52" }}>
            Verificando sesión...
          </p>
        )}
        {error && (
          <p style={{ color: "#c92a2a", margin: "18px 0 0", fontSize: 14 }}>
            {error}
          </p>
        )}
      </main>
    </div>
  );
};

const CloudProjectsList = ({ view }: { view: "drafts" | "settings" }) => {
  const [projects, setProjects] = useState<
    Array<{
      projectId: string;
      title: string | null;
      version: number;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<
    (typeof projects)[number] | null
  >(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [projectView, setProjectView] = useState<"list" | "grid">(() => {
    try {
      const savedView = window.localStorage.getItem(
        CLOUD_PROJECT_VIEW_STORAGE_KEY,
      );

      return savedView === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [hoveredDeleteProjectId, setHoveredDeleteProjectId] = useState<
    string | null
  >(null);
  const [sessionUser, setSessionUser] = useState<{
    email?: string | null;
    name?: string | null;
    image?: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([listRemoteProjects(), getRemoteAuthSession()])
      .then(([result, session]) => {
        if (cancelled) {
          return;
        }

        if (!result.authenticated || !session.authenticated) {
          window.location.assign(getCloudLoginUrl(CLOUD_DRAFTS_PATH));
          return;
        }

        setProjects(result.projects);
        setSessionUser(session.user);
        setStatus("ready");
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setError(
            error instanceof CloudStorageError
              ? error.message
              : "No se pudieron cargar los proyectos.",
          );
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CLOUD_PROJECT_VIEW_STORAGE_KEY, projectView);
    } catch {
      // Ignore storage failures; the view toggle still works for this session.
    }
  }, [projectView]);

  const handleDeleteProject = async () => {
    if (!projectToDelete) {
      return;
    }

    setDeletingProjectId(projectToDelete.projectId);
    setError(null);

    try {
      await deleteRemoteProject(projectToDelete.projectId);
      setProjects((projects) =>
        projects.filter(
          (project) => project.projectId !== projectToDelete.projectId,
        ),
      );
      setProjectToDelete(null);
    } catch (error) {
      console.error(error);
      setError(
        error instanceof CloudStorageError
          ? error.message
          : "No se pudo eliminar el proyecto.",
      );
    } finally {
      setDeletingProjectId(null);
    }
  };

  const today = new Date();
  const weekday = today.toLocaleDateString(undefined, { weekday: "short" });
  const dayMonth = today.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "long",
  });
  const year = today.getFullYear();
  const sidebarWidth = sidebarExpanded ? 190 : 54;
  const isSettingsView = view === "settings";
  const userInitial = (sessionUser?.name || sessionUser?.email || "U")
    .charAt(0)
    .toUpperCase();
  const getSidebarButtonStyle = (isActive = false) =>
    ({
      alignItems: "center",
      background: sidebarExpanded && isActive ? "#050505" : "transparent",
      border: 0,
      color: sidebarExpanded && isActive ? "#fff" : "#050505",
      cursor: "pointer",
      display: "flex",
      fontSize: 22,
      gap: 14,
      justifyContent: sidebarExpanded ? "flex-start" : "center",
      lineHeight: 1,
      marginTop: 10,
      minHeight: 34,
      padding: sidebarExpanded ? "8px 16px" : "8px 0",
      transition: "background 160ms ease, color 160ms ease, opacity 160ms ease",
    }) as const;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#efefee",
        color: "#050505",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        overflow: "hidden",
        padding: 0,
      }}
    >
      <main
        style={{
          background: "#efefee",
          border: 0,
          height: "100vh",
          margin: 0,
          maxWidth: "none",
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
          width: "100vw",
        }}
      >
        <header
          style={{
            alignItems: "center",
            borderBottom: "1px solid #151515",
            display: "flex",
            justifyContent: "space-between",
            minHeight: 26,
            padding: "0 8px",
          }}
        >
          <strong style={{ fontSize: 11 }}>
            {isSettingsView ? "Settings" : "Drafts"}
          </strong>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {weekday} / {dayMonth} / {year}
          </span>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${sidebarWidth}px 1fr 36px`,
            height: "calc(100% - 27px)",
          }}
        >
          <aside
            style={{
              alignItems: sidebarExpanded ? "stretch" : "center",
              borderRight: "1px solid #151515",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              paddingTop: 18,
              transition: "width 180ms ease",
            }}
          >
            <button
              type="button"
              aria-label="Expandir menú lateral"
              onClick={() => setSidebarExpanded((expanded) => !expanded)}
              style={{
                ...getSidebarButtonStyle(false),
                fontSize: 24,
                marginTop: 0,
              }}
            >
              <FiMenu aria-hidden="true" />
              {sidebarExpanded && <strong style={{ fontSize: 13 }}>Menu</strong>}
            </button>
            <button
              type="button"
              aria-label="Abrir drafts"
              onClick={() => window.location.assign(CLOUD_DRAFTS_PATH)}
              style={getSidebarButtonStyle(!isSettingsView)}
            >
              <FiFileText aria-hidden="true" />
              {sidebarExpanded && (
                <strong style={{ fontSize: 13 }}>Drafts</strong>
              )}
            </button>
            <button
              type="button"
              aria-label="Alternar lista y cuadrícula"
              onClick={() =>
                setProjectView((view) => (view === "list" ? "grid" : "list"))
              }
              style={{
                ...getSidebarButtonStyle(false),
                cursor: isSettingsView ? "default" : "pointer",
                opacity: isSettingsView ? 0.35 : 1,
              }}
              disabled={isSettingsView}
            >
              {projectView === "list" ? (
                <FiGrid aria-hidden="true" />
              ) : (
                <FiList aria-hidden="true" />
              )}
              {sidebarExpanded && (
                <strong style={{ fontSize: 13 }}>
                  {projectView === "list" ? "Grid view" : "List view"}
                </strong>
              )}
            </button>
            <button
              type="button"
              aria-label="Abrir configuración"
              onClick={() => window.location.assign(CLOUD_SETTINGS_PATH)}
              style={getSidebarButtonStyle(isSettingsView)}
            >
              <FiSettings aria-hidden="true" />
              {sidebarExpanded && (
                <strong style={{ fontSize: 13 }}>Settings</strong>
              )}
            </button>
            <button
              type="button"
              aria-label="Crear nuevo draft"
              onClick={() => createAndOpenRemoteProject("self")}
              style={{
                ...getSidebarButtonStyle(false),
                background: "transparent",
                fontSize: 32,
                marginTop: "auto",
                padding: sidebarExpanded ? "0 16px 14px" : "0 0 14px",
              }}
            >
              <FiPlus aria-hidden="true" />
              {sidebarExpanded && <strong style={{ fontSize: 13 }}>New draft</strong>}
            </button>
          </aside>

          <section style={{ overflow: "auto" }}>
            <div
              style={{
                alignItems: "center",
                borderBottom: "1px solid #151515",
                display: "flex",
                justifyContent: "space-between",
                minHeight: 96,
                padding: "0 18px",
              }}
            >
              <div>
                <h1 style={{ fontSize: 36, margin: 0 }}>
                  {isSettingsView ? "Account Settings" : "Zuanbase Drafts"}
                </h1>
              </div>
              <button
                type="button"
                onClick={() => createAndOpenRemoteProject("self")}
                style={{
                  background: "#050505",
                  border: 0,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 15,
                  fontWeight: 800,
                  padding: "14px 18px",
                  textTransform: "uppercase",
                }}
              >
                New draft
              </button>
            </div>

            {status === "loading" && (
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  minHeight: "calc(100vh - 345px)",
                  padding: "0 18px",
                }}
              >
                <p style={{ fontSize: 18, fontWeight: 800 }}>Cargando drafts...</p>
              </div>
            )}
            {status === "error" && (
              <p style={{ color: "#c92a2a", padding: "18px 14px" }}>{error}</p>
            )}
            {status !== "error" && error && (
              <p style={{ color: "#c92a2a", padding: "18px 14px" }}>{error}</p>
            )}

            {status === "ready" && isSettingsView && (
              <article
                style={{
                  display: "grid",
                  gap: 0,
                  gridTemplateColumns: "minmax(260px, 420px) 1fr",
                  minHeight: "calc(100vh - 124px)",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    borderRight: "1px solid #151515",
                    display: "flex",
                    justifyContent: "center",
                    padding: 32,
                  }}
                >
                  {sessionUser?.image ? (
                    <img
                      alt={sessionUser.name || sessionUser.email || "User"}
                      src={sessionUser.image}
                      style={{
                        border: "1px solid #151515",
                        height: "min(280px, 34vw)",
                        objectFit: "cover",
                        width: "min(280px, 34vw)",
                      }}
                    />
                  ) : (
                    <div
                      aria-label="Avatar"
                      style={{
                        alignItems: "center",
                        background: "#050505",
                        color: "#fff",
                        display: "flex",
                        fontSize: "min(120px, 16vw)",
                        fontWeight: 800,
                        height: "min(280px, 34vw)",
                        justifyContent: "center",
                        width: "min(280px, 34vw)",
                      }}
                    >
                      {userInitial}
                    </div>
                  )}
                </div>
                <div style={{ padding: "42px 48px" }}>
                  <span
                    style={{
                      background: "#2f63d8",
                      borderRadius: 999,
                      display: "block",
                      height: 9,
                      marginBottom: 30,
                      width: 9,
                    }}
                  />
                  <h2
                    style={{
                      fontSize: "clamp(52px, 8vw, 120px)",
                      letterSpacing: -6,
                      lineHeight: 0.9,
                      margin: "0 0 38px",
                    }}
                  >
                    {sessionUser?.name || "Usuario"}
                  </h2>
                  <dl
                    style={{
                      display: "grid",
                      gap: 0,
                      margin: 0,
                      maxWidth: 720,
                    }}
                  >
                    {[
                      ["Email", sessionUser?.email || "No disponible"],
                      ["Drafts", String(projects.length)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        style={{
                          borderTop: "1px solid #151515",
                          display: "grid",
                          gridTemplateColumns: "160px 1fr",
                          padding: "18px 0",
                        }}
                      >
                        <dt style={{ fontSize: 13, fontWeight: 800 }}>
                          {label}
                        </dt>
                        <dd style={{ fontSize: 20, margin: 0 }}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </article>
            )}

            {status === "ready" && !isSettingsView && !projects.length && (
              <article
                style={{
                  alignItems: "center",
                  display: "flex",
                  minHeight: "calc(100vh - 345px)",
                  padding: "0 18px",
                }}
              >
                <div>
                  <span
                    style={{
                      background: "#d93434",
                      borderRadius: 999,
                      display: "block",
                      height: 9,
                      marginBottom: 28,
                      width: 9,
                    }}
                  />
                  <h2 style={{ fontSize: 42, margin: "0 0 10px" }}>
                    No drafts yet
                  </h2>
                  <p style={{ color: "#555", fontSize: 18, margin: "0 0 28px" }}>
                    Crea tu primer board guardado en la nube.
                  </p>
                  <button
                    type="button"
                    onClick={() => createAndOpenRemoteProject("self")}
                    style={{
                      background: "#050505",
                      border: 0,
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 800,
                      padding: "15px 22px",
                    }}
                  >
                    Crear el primero
                  </button>
                </div>
              </article>
            )}

            {status === "ready" && !isSettingsView && !!projects.length &&
              projectView === "grid" && (
                <div
                  style={{
                    display: "grid",
                    gap: 0,
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  }}
                >
                  {projects.map((project, index) => {
                    const updatedAt = new Date(project.updatedAt);
                    const isHovered = hoveredProjectId === project.projectId;

                    return (
                      <article
                        key={project.projectId}
                        onMouseEnter={() => {
                          if (hoveredDeleteProjectId !== project.projectId) {
                            setHoveredProjectId(project.projectId);
                          }
                        }}
                        onMouseLeave={() => setHoveredProjectId(null)}
                        style={{
                          background: isHovered ? "#050505" : "#efefee",
                          borderBottom: "1px solid #151515",
                          borderRight: "1px solid #151515",
                          color: isHovered ? "#fff" : "#050505",
                          minHeight: 260,
                          padding: 18,
                          transition: "background 180ms ease, color 180ms ease",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            window.location.assign(
                              `${CLOUD_DRAFTS_PATH}/${project.projectId}`,
                            )
                          }
                          style={{
                            background: "transparent",
                            border: 0,
                            color: "inherit",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 190,
                            padding: 0,
                            textAlign: "left",
                            width: "100%",
                          }}
                        >
                          <div style={{ display: "flex", gap: 7 }}>
                            <span
                              style={{
                                background:
                                  index % 2 === 0 ? "#f4a62a" : "#d93434",
                                borderRadius: 999,
                                height: 9,
                                width: 9,
                              }}
                            />
                            <span
                              style={{
                                background: "#2f63d8",
                                borderRadius: 999,
                                height: 9,
                                width: 9,
                              }}
                            />
                          </div>
                          <strong
                            style={{
                              display: "block",
                              fontSize: 26,
                              marginTop: 34,
                            }}
                          >
                            {project.title ||
                              `Draft ${project.projectId.slice(0, 8)}`}
                          </strong>
                          <span style={{ color: isHovered ? "#cfcfcf" : "#555", fontSize: 14, marginTop: "auto" }}>
                            Updated {updatedAt.toLocaleString()}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={deletingProjectId === project.projectId}
                          onClick={() => setProjectToDelete(project)}
                          onMouseEnter={() => {
                            setHoveredProjectId(null);
                            setHoveredDeleteProjectId(project.projectId);
                          }}
                          onMouseLeave={() => setHoveredDeleteProjectId(null)}
                          style={{
                            background:
                              hoveredDeleteProjectId === project.projectId
                                ? "#f03e3e"
                                : "#c92a2a",
                            border: 0,
                            color: "#fff",
                            cursor:
                              deletingProjectId === project.projectId
                                ? "default"
                                : "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            marginTop: 16,
                            padding: "9px 12px",
                            transition: "background 160ms ease",
                          }}
                        >
                          {deletingProjectId === project.projectId
                            ? "Deleting"
                            : "Delete"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

            {status === "ready" && !isSettingsView && !!projects.length &&
              projectView === "list" &&
              projects.map((project, index) => {
                const updatedAt = new Date(project.updatedAt);
                const isHovered = hoveredProjectId === project.projectId;

                return (
                  <article
                    key={project.projectId}
                    onMouseEnter={() => {
                      if (hoveredDeleteProjectId !== project.projectId) {
                        setHoveredProjectId(project.projectId);
                      }
                    }}
                    onMouseLeave={() => setHoveredProjectId(null)}
                    style={{
                      background: isHovered ? "#050505" : "#efefee",
                      borderBottom: "1px solid #151515",
                      color: isHovered ? "#fff" : "#050505",
                      display: "grid",
                      gridTemplateColumns: "1fr 64px",
                      minHeight: 112,
                      transition: "background 180ms ease, color 180ms ease",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        window.location.assign(
                          `${CLOUD_DRAFTS_PATH}/${project.projectId}`,
                        )
                      }
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "inherit",
                        cursor: "pointer",
                        padding: "16px 18px",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", gap: 7, marginBottom: 28 }}>
                        <span
                          style={{
                            background: index % 2 === 0 ? "#f4a62a" : "#d93434",
                            borderRadius: 999,
                            height: 9,
                            width: 9,
                          }}
                        />
                        <span
                          style={{
                            background: "#2f63d8",
                            borderRadius: 999,
                            height: 9,
                            width: 9,
                          }}
                        />
                      </div>
                      <strong style={{ display: "block", fontSize: 24 }}>
                        {project.title || `Draft ${project.projectId.slice(0, 8)}`}
                      </strong>
                      <span
                        style={{
                          color: isHovered ? "#cfcfcf" : "#555",
                          display: "block",
                          fontSize: 14,
                          marginTop: 4,
                        }}
                      >
                        Updated {updatedAt.toLocaleString()}
                      </span>
                    </button>
                    <div
                      style={{
                        alignItems: "center",
                        borderLeft: "1px solid #151515",
                        display: "flex",
                      }}
                    >
                      <button
                        type="button"
                        disabled={deletingProjectId === project.projectId}
                        onClick={() => setProjectToDelete(project)}
                        onMouseEnter={() => {
                          setHoveredProjectId(null);
                          setHoveredDeleteProjectId(project.projectId);
                        }}
                        onMouseLeave={() => setHoveredDeleteProjectId(null)}
                        style={{
                          alignSelf: "stretch",
                          background:
                            hoveredDeleteProjectId === project.projectId
                              ? "#f03e3e"
                              : "#c92a2a",
                          border: 0,
                          color: "#fff",
                          cursor:
                            deletingProjectId === project.projectId
                              ? "default"
                              : "pointer",
                          fontSize: 16,
                          fontWeight: 700,
                          opacity:
                            deletingProjectId === project.projectId ? 0.55 : 1,
                          padding: 0,
                          width: "100%",
                          writingMode: "vertical-rl",
                          transition: "background 160ms ease",
                        }}
                      >
                        {deletingProjectId === project.projectId
                          ? "Deleting"
                          : "Delete"}
                      </button>
                    </div>
                  </article>
                );
              })}
          </section>

          <aside
            style={{
              alignItems: "center",
              borderLeft: "1px solid #151515",
              display: "flex",
              flexDirection: "column",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <span
              style={{
                color: "#d93434",
                fontSize: 18,
                lineHeight: 1,
                marginTop: 9,
              }}
            >
              •
            </span>
            <span style={{ marginTop: 34, writingMode: "vertical-rl" }}>
              Drafts
            </span>
            <span
              style={{
                color: "#2f63d8",
                fontSize: 18,
                lineHeight: 1,
                marginTop: 78,
              }}
            >
              •
            </span>
            <span style={{ marginTop: 34, writingMode: "vertical-rl" }}>
              Private
            </span>
            <span
              style={{
                color: "#f4a62a",
                fontSize: 18,
                lineHeight: 1,
                marginTop: "auto",
              }}
            >
              •
            </span>
            <span
              style={{
                marginBottom: 18,
                marginTop: 34,
                writingMode: "vertical-rl",
              }}
            >
              Work
            </span>
          </aside>
        </div>

        <div
          style={{
            background:
              "linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.05))",
            bottom: 0,
            height: 90,
            left: 54,
            pointerEvents: "none",
            position: "absolute",
            right: 36,
          }}
        />
        {projectToDelete && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            style={{
              alignItems: "center",
              background: "rgba(31, 31, 31, 0.45)",
              display: "flex",
              inset: 0,
              justifyContent: "center",
              padding: 24,
              position: "fixed",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: "#fffdf8",
                border: "1px solid #ded9cf",
                borderRadius: 20,
                boxShadow: "0 24px 80px rgba(31, 31, 31, 0.2)",
                maxWidth: 460,
                padding: 24,
                width: "100%",
              }}
            >
              <h2
                id="delete-project-title"
                style={{ fontSize: 24, margin: "0 0 10px" }}
              >
                Eliminar proyecto
              </h2>
              <p style={{ color: "#625d56", lineHeight: 1.5, marginTop: 0 }}>
                Esta acción eliminará permanentemente el proyecto, sus trazos,
                configuración e imágenes asociadas. No se puede deshacer.
              </p>
              <p style={{ fontWeight: 700 }}>
                {projectToDelete.title ||
                  `Proyecto ${projectToDelete.projectId.slice(0, 8)}`}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  justifyContent: "flex-end",
                  marginTop: 22,
                }}
              >
                <button
                  type="button"
                  disabled={deletingProjectId === projectToDelete.projectId}
                  onClick={() => setProjectToDelete(null)}
                  style={{
                    background: "transparent",
                    border: "1px solid #ded9cf",
                    borderRadius: 12,
                    color: "#1f1f1f",
                    cursor: "pointer",
                    fontWeight: 700,
                    padding: "11px 16px",
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingProjectId === projectToDelete.projectId}
                  onClick={handleDeleteProject}
                  style={{
                    background: "#c92a2a",
                    border: 0,
                    borderRadius: 12,
                    color: "#fff",
                    cursor:
                      deletingProjectId === projectToDelete.projectId
                        ? "default"
                        : "pointer",
                    fontWeight: 700,
                    opacity:
                      deletingProjectId === projectToDelete.projectId ? 0.7 : 1,
                    padding: "11px 16px",
                  }}
                >
                  {deletingProjectId === projectToDelete.projectId
                    ? "Eliminando..."
                    : "Eliminar todo"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const CloudProjectAccessMessage = ({
  type,
}: {
  type: "loading" | "redirecting" | "forbidden" | "missing";
}) => {
  const content = {
    loading: {
      title: "Verificando proyecto...",
      message: "Estamos validando tu sesión y permisos.",
    },
    redirecting: {
      title: "No has iniciado sesión",
      message: "Te estamos redirigiendo para iniciar sesión.",
    },
    forbidden: {
      title: "Este proyecto no te pertenece",
      message:
        "Este proyecto pertenece a otro usuario. Pídele permiso para colaborar en este proyecto.",
    },
    missing: {
      title: "Proyecto no encontrado",
      message: "El enlace no existe o el proyecto fue eliminado.",
    },
  }[type];

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f8f6f2",
        color: "#1f1f1f",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 24,
      }}
    >
      <main
        style={{
          width: "min(560px, 100%)",
          padding: 32,
          border: "1px solid #ded9cf",
          borderRadius: 20,
          background: "#fffdf8",
          boxShadow: "0 24px 80px rgba(31, 31, 31, 0.08)",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>{content.title}</h1>
        <p style={{ color: "#625d56", margin: "0 0 22px" }}>
          {content.message}
        </p>
        {type === "redirecting" && (
          <button
            type="button"
            onClick={() => window.location.assign(getCloudLoginUrl())}
            style={{
              border: 0,
              borderRadius: 12,
              background: "#1f1f1f",
              color: "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              padding: "12px 18px",
            }}
          >
            Ir a iniciar sesión
          </button>
        )}
      </main>
    </div>
  );
};

const CloudProjectAccessGate = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<
    "loading" | "ready" | "redirecting" | "forbidden" | "missing"
  >("loading");

  useEffect(() => {
    let cancelled = false;

    getRemoteProjectMetadata()
      .then(() => {
        if (!cancelled) {
          setStatus("ready");
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (error instanceof CloudStorageError) {
          if (error.status === 401) {
            setStatus("redirecting");
            window.setTimeout(() => {
              window.location.assign(getCloudLoginUrl());
            }, 1200);
            return;
          }
          if (error.status === 403) {
            setStatus("forbidden");
            return;
          }
          if (error.status === 404) {
            setStatus("missing");
            return;
          }
        }

        setStatus("missing");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status !== "ready") {
    return <CloudProjectAccessMessage type={status} />;
  }

  return <>{children}</>;
};

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = isRemoteStorageEnabled && getCloudProjectId()
    ? (await importFromRemoteStorage()) || { elements: [], appState: null }
    : importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  const [isTitleModalOpen, setIsTitleModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const loadProjectMetadata = useCallback(async () => {
    const projectId = getCloudProjectId();

    if (!isRemoteStorageEnabled || !projectId) {
      document.title = APP_NAME;
      return;
    }

    const titleCacheKey = `excalidraw-cloud-title:${projectId}`;
    const cachedTitle = sessionStorage.getItem(titleCacheKey)?.trim() || null;

    if (cachedTitle) {
      setProjectTitle(cachedTitle);
      setTitleDraft(cachedTitle);
      setIsTitleModalOpen(false);
      document.title = `${cachedTitle} | ${APP_NAME}`;
    }

    const metadata = await getRemoteProjectMetadata();
    const title = metadata?.title?.trim() || null;

    if (title) {
      sessionStorage.setItem(titleCacheKey, title);
      setProjectTitle(title);
      setTitleDraft(title);
      setIsTitleModalOpen(false);
      document.title = `${title} | ${APP_NAME}`;
      return;
    }

    sessionStorage.removeItem(titleCacheKey);
    setProjectTitle(null);
    setTitleDraft("");
    setIsTitleModalOpen(true);
    document.title = APP_NAME;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshProjectMetadata = () => {
      loadProjectMetadata().catch((error) => {
        if (!cancelled) {
          console.error(error);
        }
      });
    };

    refreshProjectMetadata();

    window.addEventListener("pageshow", refreshProjectMetadata);
    window.addEventListener(EVENT.FOCUS, refreshProjectMetadata);

    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", refreshProjectMetadata);
      window.removeEventListener(EVENT.FOCUS, refreshProjectMetadata);
    };
  }, [loadProjectMetadata]);

  const saveProjectTitle = async () => {
    const title = titleDraft.trim();

    if (!title) {
      setTitleError("El proyecto necesita un título.");
      return;
    }

    setIsSavingTitle(true);
    setTitleError(null);

    try {
      const metadata = await saveRemoteProjectTitle(title);
      const savedTitle = metadata.title || title;
      const projectId = getCloudProjectId();

      if (projectId) {
        sessionStorage.setItem(`excalidraw-cloud-title:${projectId}`, savedTitle);
      }

      setProjectTitle(savedTitle);
      setIsTitleModalOpen(false);
      document.title = `${savedTitle} | ${APP_NAME}`;
    } catch (error) {
      console.error(error);
      setTitleError(
        error instanceof CloudStorageError
          ? error.message
          : "No se pudo guardar el título.",
      );
    } finally {
      setIsSavingTitle(false);
    }
  };

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            DataStorage.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          DataStorage.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (
          !isRemoteStorageEnabled &&
          isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)
        ) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (
          !isRemoteStorageEnabled &&
          isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)
        ) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            DataStorage.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      DataStorage.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        DataStorage.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, loadImages]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      DataStorage.flushSave();

      if (
        excalidrawAPI &&
        DataStorage.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!DataStorage.isSavePaused()) {
      DataStorage.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                DataStorage.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const ExcalidrawPlusCommand = {
    label: "Excalidraw+",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: ["plus", "cloud", "server"],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };
  const ExcalidrawPlusAppCommand = {
    label: "Sign up",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: [
      "excalidraw",
      "plus",
      "cloud",
      "server",
      "signin",
      "login",
      "signup",
    ],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_APP
        }?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              {/* {excalidrawAPI?.getEditorInterface().formFactor === "desktop" && (
                <ExcalidrawPlusPromoBanner
                  isSignedIn={isExcalidrawPlusSignedUser}
                />
              )} */}

              {collabError.message && <CollabError collabError={collabError} />}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
                editorInterface={editorInterface}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.scrollToContent(element.link, { animate: true });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          theme={appTheme}
          setTheme={(theme) => setAppTheme(theme)}
          refresh={() => forceRefresh((prev) => !prev)}
          cloudStorageEnabled={isRemoteStorageEnabled}
          onCreateCloudProject={() => createAndOpenRemoteProject("blank")}
          onOpenCloudProjects={() => window.location.assign(CLOUD_DRAFTS_PATH)}
        />
        <div className="excalidraw-custom-app-title">
          {projectTitle || "Excalidraw Custom Infrastructure"}
        </div>
        {isTitleModalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              display: "grid",
              placeItems: "center",
              background: "rgba(14, 14, 18, 0.55)",
              padding: 24,
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveProjectTitle();
              }}
              style={{
                width: "min(420px, 100%)",
                borderRadius: 18,
                background: "var(--popup-bg-color, #232329)",
                color: "var(--text-primary-color, #f4f4f5)",
                boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
                padding: 24,
              }}
            >
              <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>
                Nombra tu proyecto
              </h2>
              <p style={{ color: "#a8a5b5", margin: "0 0 18px" }}>
                Este título aparecerá en el board, la pestaña del navegador y el
                listado de proyectos.
              </p>
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder="Ej. Mapa mental de campaña"
                maxLength={255}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #4f4b63",
                  borderRadius: 10,
                  background: "#15151a",
                  color: "#fff",
                  fontSize: 15,
                  padding: "12px 14px",
                  outline: "none",
                }}
              />
              {titleError && (
                <p style={{ color: "#ff8787", margin: "12px 0 0" }}>
                  {titleError}
                </p>
              )}
              <button
                type="submit"
                disabled={isSavingTitle}
                style={{
                  width: "100%",
                  border: 0,
                  borderRadius: 10,
                  background: "#a899ff",
                  color: "#17151f",
                  cursor: isSavingTitle ? "default" : "pointer",
                  fontSize: 15,
                  fontWeight: 700,
                  marginTop: 18,
                  padding: "12px 14px",
                  opacity: isSavingTitle ? 0.75 : 1,
                }}
              >
                {isSavingTitle ? "Guardando..." : "Guardar título"}
              </button>
            </form>
          </div>
        )}
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              ...CommandPalette.defaultItems.toggleTheme,
              perform: () => {
                setAppTheme(
                  editorTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK,
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  if (
    isRemoteStorageEnabled &&
    window.location.pathname === "/" &&
    !window.location.search &&
    !window.location.hash &&
    !getCloudProjectId()
  ) {
    return <CloudProjectsHome />;
  }

  if (
    isRemoteStorageEnabled &&
    window.location.pathname === CLOUD_DRAFTS_PATH
  ) {
    return <CloudProjectsList view="drafts" />;
  }

  if (
    isRemoteStorageEnabled &&
    window.location.pathname === CLOUD_SETTINGS_PATH
  ) {
    return <CloudProjectsList view="settings" />;
  }

  if (isRemoteStorageEnabled && getCloudProjectId()) {
    return (
      <TopErrorBoundary>
        <CloudProjectAccessGate>
          <Provider store={appJotaiStore}>
            <ExcalidrawAPIProvider>
              <ExcalidrawWrapper />
            </ExcalidrawAPIProvider>
          </Provider>
        </CloudProjectAccessGate>
      </TopErrorBoundary>
    );
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
