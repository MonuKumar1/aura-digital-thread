import { useState } from "react";
import Icon from "../components/Icon";
import { ErrorBox } from "../components/Loading";
import type { WorkItemManifest } from "../types";
import { ManifestTree } from "./results/TrackerPanel";

const MAX_BYTES = 1024 * 1024;
const KINDS = new Set(["epic", "feature", "task"]);

/** Structural validation of a work-item manifest JSON (the shape produced by POST /api/tracker/{id}/manifest). */
export function validateManifest(data: unknown): { manifest: WorkItemManifest | null; errors: string[] } {
  const errors: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(data)) return { manifest: null, errors: ["Root must be a JSON object."] };
  const checkItem = (item: unknown, path: string, expected?: string) => {
    if (!isObj(item)) return errors.push(`${path} must be an object.`);
    if (typeof item.title !== "string" || !item.title.trim()) errors.push(`${path}.title must be a non-empty string.`);
    if (typeof item.description_html !== "string") errors.push(`${path}.description_html must be a string.`);
    if (typeof item.kind !== "string" || !KINDS.has(item.kind)) errors.push(`${path}.kind must be epic, feature or task.`);
    else if (expected && item.kind !== expected) errors.push(`${path}.kind should be "${expected}".`);
    if (item.children !== undefined) {
      if (!Array.isArray(item.children)) errors.push(`${path}.children must be an array.`);
      else item.children.forEach((c, i) => checkItem(c, `${path}.children[${i}]`, "task"));
    }
    return 0;
  };
  checkItem(data.epic, "epic", "epic");
  if (!Array.isArray(data.children)) errors.push("children must be an array of features.");
  else data.children.forEach((c, i) => checkItem(c, `children[${i}]`, "feature"));
  if (errors.length) return { manifest: null, errors };
  const children = data.children as WorkItemManifest["children"];
  const counts = { features: children.length, tasks: children.reduce((a, c) => a + (c.children?.length ?? 0), 0) };
  return { manifest: { ...(data as unknown as WorkItemManifest), counts }, errors };
}

export default function ManifestUpload() {
  const [manifest, setManifest] = useState<WorkItemManifest | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [over, setOver] = useState(false);

  async function onFile(file: File | undefined) {
    setManifest(null);
    setErrors([]);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".json")) return setError(new Error("Only .json files are accepted."));
    if (file.size > MAX_BYTES) return setError(new Error("File exceeds 1 MB."));
    try {
      const result = validateManifest(JSON.parse(await file.text()));
      setManifest(result.manifest);
      setErrors(result.errors);
    } catch {
      setError(new Error("File is not valid JSON."));
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Manifest upload</h1><p>Validate and preview a Work Tracker manifest JSON (for example one exported from an initiative's Work Tracker tab).</p></div>
      </div>
      <div className="card">
        <label className={`dropzone ${over ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files?.[0]); }}>
          <Icon name="upload" size={26} />
          <strong>{fileName || "Drop a manifest here or click to browse"}</strong>
          <span className="small">.json up to 1 MB</span>
          <input type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div style={{ marginTop: 16 }}>
          <ErrorBox error={error} />
          {errors.length > 0 && (
            <div className="error-box"><strong>{fileName} is invalid ({errors.length} problem(s))</strong><ul style={{ margin: "4px 0 0" }}>{errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul></div>
          )}
          {manifest && (
            <>
              <div className="ok-box">{fileName} is valid: 1 epic, {manifest.counts.features} features, {manifest.counts.tasks} tasks. HTML is sanitized for preview.</div>
              <div style={{ marginTop: 12 }}><ManifestTree manifest={manifest} /></div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
