import { mockApi } from "../mocks/mockApi";
import { useMockApi } from "../runtimeEnv";
import { httpApi } from "./http";
import type { MeridianApi } from "./types";

export const api: MeridianApi = useMockApi() ? mockApi : httpApi;
export { ApiError } from "./types";
export type { MeridianApi } from "./types";
