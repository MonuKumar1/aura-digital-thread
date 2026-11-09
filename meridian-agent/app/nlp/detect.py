from __future__ import annotations

import re
from typing import Any

TYPE_KEYWORDS: dict[str, list[str]] = {
    "AI_INITIATIVE": ["ai", "ml", "machine learning", "model", "llm", "copilot", "chatbot", "classifier", "computer vision", "genai"],
    "CLOUD": ["cloud", "saas", "migrate to", "migration", "kubernetes", "serverless", "aws", "azure", "gcp"],
    "REGULATORY": ["regulator", "regulatory", "compliance", "mandate", "reporting requirement", "legislation"],
    "NEW_SERVICE": ["new service", "launch", "new product", "new journey", "greenfield", "new app"],
    "TECH_CHANGE": ["upgrade", "patch", "refactor", "replace", "migrate", "tls", "library", "infrastructure", "change"],
}
FLAG_KEYWORDS: dict[str, list[str]] = {
    "internet_facing": ["public", "internet", "website", "customer portal", "public api", "web app"],
    "external_facing": ["partner", "external", "third-party api", "open api"],
    "handles_payment_data": ["payment", "card", "pci", "checkout", "pan"],
    "personal_data_processed": ["personal data", "pii", "customer data", "employee data", "customer records", "email address"],
    "sensitive_personal_data_processed": ["health", "biometric", "ethnicity", "religion", "sensitive data", "medical"],
    "cross_border_data_transfer": ["cross-border", "cross border", "overseas", "offshore", "international transfer", "another region"],
    "ai_ml_component_present": ["ai", "ml", "machine learning", "model", "llm", "neural", "classifier"],
    "biometric_data": ["biometric", "face recognition", "facial", "fingerprint", "voiceprint"],
    "third_party_vendor_involved": ["vendor", "third party", "third-party", "supplier", "saas provider"],
    "new_pipeline_required": ["new pipeline", "ci/cd", "build pipeline", "deployment pipeline"],
    "outage_expected": ["outage", "downtime", "maintenance window", "service interruption"],
    "customer_impacting": ["customers", "customer-facing", "customer impact", "end users"],
    "important_business_service": ["critical service", "important business service", "core banking", "payments"],
    "disaster_recovery_required": ["disaster recovery", "failover", "dr test", "dr "],
}


def _matches(text: str, keywords: list[str]) -> list[str]:
    return [k for k in keywords if re.search(rf"(?<![a-z0-9]){re.escape(k.strip())}(?![a-z0-9])", text)]


def detect_intent(text: str) -> dict[str, Any]:
    """Keyword-based intent detection; no external calls."""
    low = text.lower()
    scores = {t: len(_matches(low, kws)) for t, kws in TYPE_KEYWORDS.items()}
    best = max(scores, key=lambda t: (scores[t], -list(TYPE_KEYWORDS).index(t)))
    total = sum(scores.values())
    flags: dict[str, bool] = {}
    matched: dict[str, list[str]] = {}
    for field, kws in FLAG_KEYWORDS.items():
        hits = _matches(low, kws)
        if hits:
            flags[field] = True
            matched[field] = hits
    return {
        "initiative_type": best if scores[best] > 0 else "TECH_CHANGE",
        "confidence": round(scores[best] / total, 2) if total else 0.2,
        "type_scores": scores,
        "flags": flags,
        "matched_keywords": matched,
    }
