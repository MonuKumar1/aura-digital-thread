import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "./types";

const USER_KEY = "meridian.user";

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/** Mock SSO: any name/email is accepted. No credentials are stored. */
export function login(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify({ name: user.name.trim(), email: user.email.trim().toLowerCase() }));
}

export function logout(): void {
  localStorage.removeItem(USER_KEY);
}

export function RequireAuth({ children }: { children: ReactElement }) {
  const location = useLocation();
  if (!getUser()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
