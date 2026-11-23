export const secureBackend = import.meta.env.VITE_SECURE_BACKEND === "true";
let deviceId;
let staffApproval;
export const getStaffApproval = () => staffApproval;
export async function api(path, { method = "GET", body, signal } = {}) {
  if (!deviceId) {
    deviceId = sessionStorage.getItem("cafe-device-id") || crypto.randomUUID();
    sessionStorage.setItem("cafe-device-id", deviceId);
  }
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-device-id": deviceId },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "session")
      window.dispatchEvent(new Event("cafe-session-expired"));
    throw Object.assign(new Error(result.message || "Request failed."), {
      status: response.status,
    });
  }
  if (path === "verify-pin" && result.approval) staffApproval = result.approval;
  return result;
}
