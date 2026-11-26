// Small helper for talking to the server.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(url, init);
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data && (data as any).error) || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>("GET", "/api" + url),
  post: <T = any>(url: string, body?: unknown) => request<T>("POST", "/api" + url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>("PUT", "/api" + url, body),
  patch: <T = any>(url: string, body?: unknown) => request<T>("PATCH", "/api" + url, body),
  del: <T = any>(url: string, body?: unknown) => request<T>("DELETE", "/api" + url, body),
};

/** Read an image file's pixel size in the browser before uploading it. */
export function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("That image couldn't be read"));
    img.src = URL.createObjectURL(file);
  });
}

export function downloadFile(name: string, content: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
