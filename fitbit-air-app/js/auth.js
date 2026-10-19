// Google-Anmeldung über Google Identity Services (OAuth 2.0 Token-Flow im Browser).
// Es wird kein eigener Server benötigt; das Zugriffstoken bleibt nur in dieser Sitzung.

const TOKEN_KEY = "fa.token";
let gisLoading = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Google-Anmeldung konnte nicht geladen werden (offline?)"));
    document.head.appendChild(s);
  });
  return gisLoading;
}

export function getToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    if (t && t.expiresAt > Date.now() + 60_000) return t.accessToken;
  } catch { /* nichts gespeichert */ }
  return null;
}

export function clearToken() {
  const token = getToken();
  sessionStorage.removeItem(TOKEN_KEY);
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
}

export async function signIn({ clientId, scopes }) {
  if (!clientId) throw new Error("Bitte zuerst eine OAuth-Client-ID in den Einstellungen eintragen.");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
          accessToken: resp.access_token,
          expiresAt: Date.now() + Number(resp.expires_in) * 1000,
        }));
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || "Anmeldung abgebrochen")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}
