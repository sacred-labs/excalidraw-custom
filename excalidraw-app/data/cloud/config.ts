const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

export const CLOUD_API_URL = import.meta.env.VITE_APP_API_URL || "";

export const getCloudLoginUrl = (callbackPath = "/") => {
  const callbackUrl = `${window.location.origin}${callbackPath}`;

  return `${CLOUD_API_URL}/login?callbackUrl=${encodeURIComponent(
    callbackUrl,
  )}`;
};

export const isCloudDebugEnabled = () => {
  return (
    import.meta.env.VITE_APP_CLOUD_DEBUG === "true" ||
    LOCAL_HOSTNAMES.has(window.location.hostname)
  );
};

export const cloudDebugLog = (...args: unknown[]) => {
  if (isCloudDebugEnabled()) {
    console.log("[cloud-storage]", ...args);
  }
};

export const cloudDebugError = (...args: unknown[]) => {
  if (isCloudDebugEnabled()) {
    console.error("[cloud-storage]", ...args);
  }
};

export class CloudStorageError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CloudStorageError";
  }
}

export const getCloudErrorMessage = (
  action: string,
  status: number,
  details?: unknown,
) => {
  if (!isCloudDebugEnabled()) {
    return `${action} failed`;
  }

  const reason = status === 401
    ? "Unauthorized. El backend no recibió una sesión válida. Inicia sesión en api/ o revisa cookies/credentials entre puertos."
    : status === 400
      ? "Bad request. Revisa que projectId sea un UUID válido y que el body tenga el formato esperado."
      : status === 403
        ? "Forbidden. La sesión existe, pero no tiene permiso para este recurso."
        : status >= 500
          ? "Server error. Revisa la consola del backend api/."
          : "Unexpected response.";

  return `${action} failed (${status}). ${reason} Details: ${JSON.stringify(
    details ?? null,
  )}`;
};
