import { clearAppStateForLocalStorage } from "@excalidraw/excalidraw/appState";
import { debounce } from "@excalidraw/common";

import { getNonDeletedElements } from "@excalidraw/element";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";

import { SAVE_TO_REMOTE_STORAGE_TIMEOUT } from "../../app_constants";

import { FileManager } from "../FileManager";
import { FileStatusStore } from "../fileStatusStore";
import { Locker } from "../Locker";

import {
  CLOUD_API_URL,
  CloudStorageError,
  cloudDebugError,
  cloudDebugLog,
  getCloudErrorMessage,
  isCloudDebugEnabled,
} from "./config";

export { CloudStorageError } from "./config";

const CLOUD_PROJECT_PATH_RE =
  /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i;

const remoteFetch = async (path: string, init?: RequestInit) => {
  const url = `${CLOUD_API_URL}${path}`;

  cloudDebugLog("request", init?.method || "GET", url, init?.body || null);

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  cloudDebugLog("response", response.status, init?.method || "GET", url);

  return response;
};

const readResponseDetails = async (response: Response) => {
  try {
    return await response.clone().json();
  } catch {
    try {
      return await response.clone().text();
    } catch {
      return null;
    }
  }
};

const throwCloudError = async (action: string, response: Response) => {
  const details = await readResponseDetails(response);
  const message = getCloudErrorMessage(action, response.status, details);

  cloudDebugError(message);

  throw new CloudStorageError(message, response.status, details);
};

export const getCloudProjectId = () => {
  const match = window.location.pathname.match(CLOUD_PROJECT_PATH_RE);

  return match?.[1] || null;
};

export const createRemoteProject = async (projectId: string) => {
  const response = await remoteFetch("/api/excalidraw/scene", {
    method: "PUT",
    body: JSON.stringify({
      projectId,
      elements: [],
      appState: {},
    }),
  });

  if (!response.ok) {
    await throwCloudError("Create remote project", response);
  }
};

export const createAndOpenRemoteProject = async (target: "self" | "blank") => {
  const projectId = window.crypto.randomUUID();

  await createRemoteProject(projectId);

  const url = `/projects/${projectId}`;

  if (target === "blank") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  window.location.assign(url);
};

export type RemoteProject = {
  projectId: string;
  title: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type RemoteProjectMetadata = {
  projectId: string;
  title: string | null;
  version: number;
  updatedAt: string;
};

export const listRemoteProjects = async () => {
  const response = await remoteFetch("/api/excalidraw/projects", {
    method: "GET",
  });

  if (response.status === 401) {
    return { authenticated: false as const, projects: [] };
  }

  if (!response.ok) {
    await throwCloudError("List remote projects", response);
  }

  const data = await response.json();

  return {
    authenticated: true as const,
    projects: (data.projects || []) as RemoteProject[],
  };
};

export const deleteRemoteProject = async (projectId: string) => {
  const response = await remoteFetch("/api/excalidraw/projects", {
    method: "DELETE",
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) {
    await throwCloudError("Delete remote project", response);
  }
};

export const getRemoteProjectMetadata = async () => {
  const projectId = getCloudProjectId();

  if (!projectId) {
    return null;
  }

  const response = await remoteFetch(
    `/api/excalidraw/scene?projectId=${projectId}`,
  );

  if (!response.ok) {
    await throwCloudError("Load remote project metadata", response);
  }

  const { scene } = await response.json();

  return scene as RemoteProjectMetadata | null;
};

export const saveRemoteProjectTitle = async (title: string) => {
  const projectId = getCloudProjectId();

  if (!projectId) {
    throw new CloudStorageError("Missing cloud project id");
  }

  const response = await remoteFetch("/api/excalidraw/scene", {
    method: "PUT",
    body: JSON.stringify({
      projectId,
      title,
    }),
  });

  if (!response.ok) {
    await throwCloudError("Save remote project title", response);
  }

  const { scene } = await response.json();

  return scene as RemoteProjectMetadata;
};

export const getRemoteAuthSession = async () => {
  const response = await remoteFetch("/api/excalidraw/auth/session", {
    method: "GET",
  });

  if (response.status === 401) {
    return { authenticated: false as const, user: null };
  }

  if (!response.ok) {
    await throwCloudError("Load auth session", response);
  }

  const data = await response.json();

  return {
    authenticated: !!data.authenticated as true,
    user: data.user || null,
  };
};

export const importFromRemoteStorage = async (): Promise<ImportedDataState | null> => {
  try {
    const projectId = getCloudProjectId();

    if (!projectId) {
      return null;
    }

    const response = await remoteFetch(
      `/api/excalidraw/scene?projectId=${projectId}`,
    );

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      await throwCloudError("Load remote scene", response);
    }

    const { scene } = await response.json();

    if (!scene) {
      return null;
    }

    return {
      elements: scene.elements || [],
      appState: scene.appState || null,
    };
  } catch (error) {
    cloudDebugError(error);
    return null;
  }
};

class RemoteFileManager extends FileManager {
  clearObsoleteFiles = async (_opts: { currentFileIds: FileId[] }) => {
    // Remote cleanup should be explicit/server-side to avoid deleting files from
    // another tab or device using a stale scene snapshot.
  };
}

type SavingLockTypes = "collaboration";

export class RemoteData {
  private static _save = debounce(
    async (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      const projectId = getCloudProjectId();

      if (!projectId) {
        return;
      }

      const _appState = clearAppStateForLocalStorage(appState);

      const response = await remoteFetch("/api/excalidraw/scene", {
        method: "PUT",
        body: JSON.stringify({
          projectId,
          elements: getNonDeletedElements(elements),
          appState: _appState,
        }),
      });

      if (!response.ok) {
        await throwCloudError("Save remote scene", response);
      }

      await this.fileStorage.saveFiles({
        elements,
        files,
      });
      onFilesSaved();
    },
    SAVE_TO_REMOTE_STORAGE_TIMEOUT,
  );

  static save = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ) => {
    if (!this.isSavePaused()) {
      this._save(elements, appState, files, onFilesSaved);
    }
  };

  static flushSave = () => {
    this._save.flush();
  };

  private static locker = new Locker<SavingLockTypes>();

  static pauseSave = (lockType: SavingLockTypes) => {
    this.locker.lock(lockType);
  };

  static resumeSave = (lockType: SavingLockTypes) => {
    this.locker.unlock(lockType);
  };

  static isSavePaused = () => {
    return document.hidden || this.locker.isLocked();
  };

  static fileStorage = new RemoteFileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    async getFiles(ids) {
      const projectId = getCloudProjectId();

      if (!projectId) {
        return {
          loadedFiles: [],
          erroredFiles: new Map(ids.map((id) => [id, true])),
        };
      }

      const response = await remoteFetch("/api/excalidraw/files", {
        method: "PUT",
        body: JSON.stringify({ projectId, ids }),
      });

      if (!response.ok) {
        if (isCloudDebugEnabled()) {
          await throwCloudError("Load remote files", response);
        }

        return {
          loadedFiles: [],
          erroredFiles: new Map(ids.map((id) => [id, true])),
        };
      }

      const data = await response.json();
      const loadedFiles = (data.loadedFiles || []) as BinaryFileData[];
      const erroredFiles = new Map<FileId, true>(
        (data.erroredFiles || []).map((id: FileId) => [id, true]),
      );

      return { loadedFiles, erroredFiles };
    },
    async saveFiles({ addedFiles }) {
      const projectId = getCloudProjectId();
      const filesToSave = [...addedFiles.values()];

      if (!projectId || !filesToSave.length) {
        return {
          savedFiles: new Map<FileId, BinaryFileData>(),
          erroredFiles: projectId
            ? new Map<FileId, BinaryFileData>()
            : addedFiles,
        };
      }

      const response = await remoteFetch("/api/excalidraw/files", {
        method: "POST",
        body: JSON.stringify({ projectId, files: filesToSave }),
      });

      if (!response.ok) {
        if (isCloudDebugEnabled()) {
          await throwCloudError("Save remote files", response);
        }

        return {
          savedFiles: new Map<FileId, BinaryFileData>(),
          erroredFiles: addedFiles,
        };
      }

      const data = await response.json();
      const savedFiles = new Map<FileId, BinaryFileData>();
      const erroredFiles = new Map<FileId, BinaryFileData>();

      for (const id of data.savedFiles || []) {
        const file = addedFiles.get(id);
        if (file) {
          savedFiles.set(id, file);
        }
      }

      for (const id of data.erroredFiles || []) {
        const file = addedFiles.get(id);
        if (file) {
          erroredFiles.set(id, file);
        }
      }

      return { savedFiles, erroredFiles };
    },
  });
}
