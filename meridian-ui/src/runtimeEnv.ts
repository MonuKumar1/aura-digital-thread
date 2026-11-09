const MOCK_OVERRIDE_KEY = "meridian.useMock";

function readOverride(): string | null {
  try {
    return localStorage.getItem(MOCK_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

function truthy(v: string | undefined | null): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/** Precedence: header toggle (localStorage) > window.__ENV__ (runtime) > VITE_USE_MOCK (build) > mock. */
export function useMockApi(): boolean {
  return truthy(readOverride()) ?? truthy(window.__ENV__?.USE_MOCK) ?? truthy(import.meta.env.VITE_USE_MOCK) ?? true;
}

export function setUseMockApi(value: boolean): void {
  try {
    localStorage.setItem(MOCK_OVERRIDE_KEY, String(value));
  } catch {
    /* storage unavailable: toggle lasts for this page only */
  }
}

export function apiBaseUrl(): string {
  const base = window.__ENV__?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "";
  return base.replace(/\/$/, "");
}
