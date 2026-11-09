"""Generates the canonical data files in ../data. Re-run after editing; output is deterministic."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

ENUMS: dict[str, list[str]] = {
    "initiative_type": ["NEW_SERVICE", "TECH_CHANGE", "AI_INITIATIVE", "CLOUD", "REGULATORY"],
    "budget_band": ["LOW", "MEDIUM", "HIGH"],
    "data_classification": ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
    "lawful_basis": ["NONE", "CONSENT", "CONTRACT", "LEGAL_OBLIGATION", "LEGITIMATE_INTEREST"],
    "data_subjects_band": ["NONE", "SMALL", "MEDIUM", "LARGE"],
    "authentication_method": ["SSO", "MFA", "API_KEY", "PASSWORD", "NONE"],
    "secrets_management": ["VAULT", "ENV", "NONE"],
    "autonomy_level": ["NONE", "ASSISTIVE", "SEMI_AUTONOMOUS", "FULLY_AUTONOMOUS"],
    "ai_model_type": ["NONE", "LLM", "CLASSIFIER", "REGRESSION", "COMPUTER_VISION"],
    "implementation_method": ["AUTOMATED_PIPELINE", "SCRIPTED", "MANUAL"],
    "target_environment": ["ON_PREM", "PRIVATE_CLOUD", "PUBLIC_CLOUD", "HYBRID"],
    "cloud_service_type": ["NONE", "IAAS", "PAAS", "SAAS"],
    "architecture_pattern": ["MONOLITH", "MICROSERVICES", "EVENT_DRIVEN", "SERVERLESS", "BATCH"],
    "change_window": ["BUSINESS_HOURS", "AFTER_HOURS", "WEEKEND"],
}

# (id, section, type, label, question phrase, autofill source, required)
FIELDS: list[tuple[str, str, str, str, str, str | None, bool]] = [
    ("initiative_name", "Basics", "text", "Initiative name", "What is the name of the initiative?", None, True),
    ("initiative_type", "Basics", "select", "Initiative type", "What type of change is this?", None, True),
    ("description", "Basics", "textarea", "Description", "Describe the change and its business outcome.", None, False),
    ("application_ci_id", "Basics", "text", "Application CI ID", "Which configuration item does the change affect?", None, False),
    ("portfolio_id", "Basics", "text", "Portfolio investment ID", "Which portfolio investment funds this work?", "portfolio", False),
    ("sponsor_name", "Basics", "text", "Sponsor name", "Who is the accountable business sponsor?", None, False),
    ("sponsor_email", "Basics", "email", "Sponsor email", "What is the sponsor's email address?", None, True),
    ("business_unit", "Basics", "text", "Business unit", "Which business unit owns the service?", "cmdb", False),
    ("delivery_lead_email", "Basics", "email", "Delivery lead email", "Who is the delivery lead?", None, False),
    ("target_go_live", "Basics", "date", "Target go-live", "What is the planned go-live date?", None, False),
    ("budget_band", "Basics", "select", "Budget band", "What is the budget band of the investment?", "portfolio", False),
    ("regulatory_notification_required", "Basics", "boolean", "Regulatory notification required", "Must a regulator be notified of this change?", "portfolio", False),
    ("personal_data_processed", "Data & Privacy", "boolean", "Personal data processed", "Does the change process personal data?", None, False),
    ("sensitive_personal_data_processed", "Data & Privacy", "boolean", "Sensitive personal data", "Is special-category or sensitive personal data processed?", None, False),
    ("cross_border_data_transfer", "Data & Privacy", "boolean", "Cross-border transfer", "Is data transferred across jurisdictions?", None, False),
    ("transfer_destinations", "Data & Privacy", "text", "Transfer destinations", "Which jurisdictions receive transferred data?", None, False),
    ("data_classification", "Data & Privacy", "select", "Data classification", "What is the highest data classification handled?", None, False),
    ("lawful_basis", "Data & Privacy", "select", "Lawful basis", "What is the lawful basis for processing?", None, False),
    ("data_retention_months", "Data & Privacy", "number", "Retention (months)", "How long is data retained, in months?", None, False),
    ("data_subjects_band", "Data & Privacy", "select", "Data subjects volume", "Approximately how many data subjects are affected?", None, False),
    ("data_minimisation_applied", "Data & Privacy", "boolean", "Data minimisation applied", "Has data minimisation been applied?", None, False),
    ("internet_facing", "Security", "boolean", "Internet facing", "Is the service reachable from the public internet?", None, False),
    ("external_facing", "Security", "boolean", "External facing", "Do external parties integrate with the service?", None, False),
    ("handles_payment_data", "Security", "boolean", "Handles payment data", "Does the service store, process or transmit payment card data?", None, False),
    ("authentication_method", "Security", "select", "Authentication method", "How do users authenticate?", None, False),
    ("privileged_access_required", "Security", "boolean", "Privileged access required", "Does the change require privileged access?", None, False),
    ("encryption_at_rest", "Security", "boolean", "Encryption at rest", "Is data encrypted at rest?", None, False),
    ("encryption_in_transit", "Security", "boolean", "Encryption in transit", "Is data encrypted in transit?", None, False),
    ("third_party_vendor_involved", "Security", "boolean", "Third-party vendor involved", "Is a third-party vendor involved?", None, False),
    ("vendor_name", "Security", "text", "Vendor name", "Which vendor supplies the component?", None, False),
    ("penetration_test_planned", "Security", "boolean", "Penetration test planned", "Is a penetration test planned before go-live?", None, False),
    ("secrets_management", "Security", "select", "Secrets management", "How are secrets managed?", None, False),
    ("ai_ml_component_present", "AI", "boolean", "AI/ML component present", "Does the change include an AI or ML component?", None, False),
    ("autonomy_level", "AI", "select", "Autonomy level", "What level of autonomy does the AI have?", None, False),
    ("biometric_data", "AI", "boolean", "Biometric data", "Does the AI use biometric data?", None, False),
    ("ai_model_type", "AI", "select", "Model type", "What type of model is used?", None, False),
    ("human_in_the_loop", "AI", "boolean", "Human in the loop", "Is a human in the loop for AI decisions?", None, False),
    ("ai_decision_impacts_customers", "AI", "boolean", "AI decisions impact customers", "Do AI outputs directly affect customers?", None, False),
    ("training_data_contains_personal_data", "AI", "boolean", "Training data has personal data", "Does training data contain personal data?", None, False),
    ("new_pipeline_required", "Architecture", "boolean", "New pipeline required", "Is a new delivery pipeline required?", None, False),
    ("implementation_method", "Architecture", "select", "Implementation method", "How will the change be implemented?", None, False),
    ("target_environment", "Architecture", "select", "Target environment", "Where will the service run?", "cmdb", False),
    ("cloud_service_type", "Architecture", "select", "Cloud service type", "Which cloud service model is used?", "cmdb", False),
    ("architecture_pattern", "Architecture", "select", "Architecture pattern", "Which architecture pattern applies?", "cmdb", False),
    ("user_growth_pct", "Architecture", "number", "User growth (%)", "What user growth is expected, in percent?", None, False),
    ("sla_specified", "Architecture", "boolean", "SLA specified", "Is a formal SLA specified?", None, False),
    ("integration_count", "Architecture", "number", "Integration count", "How many integrations are added or changed?", None, False),
    ("new_technology_introduced", "Architecture", "boolean", "New technology introduced", "Does the change introduce technology new to the estate?", None, False),
    ("important_business_service", "Resilience", "boolean", "Important business service", "Does the change support an important business service?", "cmdb", False),
    ("disaster_recovery_required", "Resilience", "boolean", "Disaster recovery required", "Is disaster recovery required?", None, False),
    ("rto_hours", "Resilience", "number", "RTO (hours)", "What is the recovery time objective?", "cmdb", False),
    ("rpo_hours", "Resilience", "number", "RPO (hours)", "What is the recovery point objective?", "cmdb", False),
    ("customer_impacting", "Resilience", "boolean", "Customer impacting", "Could customers be impacted by the change?", None, False),
    ("peak_tps", "Resilience", "number", "Peak TPS", "What is the expected peak transactions per second?", None, False),
    ("outage_expected", "Change", "boolean", "Outage expected", "Is an outage expected during implementation?", None, False),
    ("outage_duration_minutes", "Change", "number", "Outage duration (min)", "How long is the expected outage, in minutes?", None, False),
    ("backout_plan_summary", "Change", "textarea", "Backout plan", "Summarise the backout plan.", None, False),
    ("customers_impacted_count", "Change", "number", "Customers impacted", "How many customers could be impacted?", None, False),
    ("vendor_change_involved", "Change", "boolean", "Vendor change involved", "Does the vendor perform part of the change?", None, False),
    ("change_window", "Change", "select", "Change window", "In which change window will this be implemented?", None, False),
]

SECTION_META: dict[str, tuple[list[str], str]] = {
    "Basics": (["Portfolio", "ITSM", "Change Mgmt", "Wiki"], "clarity"),
    "Data & Privacy": (["DRA", "Security Portal", "Vendor Risk"], "privacy"),
    "Security": (["Security Portal", "Cloud Onboarding", "Vendor Risk"], "security"),
    "AI": (["AI Review Board", "DRA"], "ai_ethics"),
    "Architecture": (["Architecture Portal", "Cloud Onboarding", "ITSM"], "architecture"),
    "Resilience": (["Business Impact", "ITSM", "Architecture Portal"], "resilience"),
    "Change": (["Change Mgmt", "ITSM"], "release"),
}
SCOPING_FIELDS = {"initiative_type", "description", "budget_band", "target_go_live"}
PREFIXES = ["", "Confirm: ", "For the {system} record: "]


def build_fields() -> list[dict[str, Any]]:
    out = []
    for fid, section, ftype, label, phrase, autofill, required in FIELDS:
        item: dict[str, Any] = {"id": fid, "section": section, "type": ftype, "label": label, "help": phrase, "required": required}
        if fid in ENUMS:
            item["options"] = ENUMS[fid]
        if autofill:
            item["autofill_source"] = autofill
        out.append(item)
    return out


def build_questions() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    coverage: dict[str, Any] = {}
    n = 0
    for idx, (fid, section, _t, _l, phrase, _a, _r) in enumerate(FIELDS):
        systems, agent = SECTION_META[section]
        if fid in SCOPING_FIELDS:
            agent = "scoping"
        for k in range(2):
            n += 1
            system = systems[(idx + k) % len(systems)]
            qid = f"Q-{n:03d}"
            text = PREFIXES[(idx + k) % len(PREFIXES)].format(system=system) + phrase
            questions.append({"id": qid, "system": system, "section": section, "text": text})
            coverage[qid] = {"fields": [fid], "owner_agent": agent}
    return questions, {"version": 1, "questions": coverage}


CMDB = [
    {"ci_id": "CI-1001", "app_name": "Payments Gateway", "owner": "alex.rivera@example.com", "domain": "Payments", "sub_domain": "Card Processing", "ibs": True, "rto_hours": 2, "rpo_hours": 0.25, "cloud_service_type": "PAAS", "target_environment": "PUBLIC_CLOUD", "architecture_pattern": "MICROSERVICES", "entry_point_url": "https://payments.example.com", "ip": "192.0.2.10", "risk_band": "High", "support_group": "Payments Platform"},
    {"ci_id": "CI-1002", "app_name": "Customer Portal", "owner": "sam.okafor@example.com", "domain": "Digital Channels", "sub_domain": "Web", "ibs": True, "rto_hours": 4, "rpo_hours": 1, "cloud_service_type": "PAAS", "target_environment": "HYBRID", "architecture_pattern": "MICROSERVICES", "entry_point_url": "https://portal.example.com", "ip": "192.0.2.20", "risk_band": "Medium", "support_group": "Digital Web"},
    {"ci_id": "CI-1003", "app_name": "HR Analytics", "owner": "priya.nair@example.com", "domain": "Corporate", "sub_domain": "People", "ibs": False, "rto_hours": 48, "rpo_hours": 24, "cloud_service_type": "SAAS", "target_environment": "PUBLIC_CLOUD", "architecture_pattern": "BATCH", "entry_point_url": "https://hr-analytics.example.com", "ip": "198.51.100.15", "risk_band": "Low", "support_group": "Corporate Apps"},
    {"ci_id": "CI-1004", "app_name": "Fraud Scoring Engine", "owner": "jordan.lee@example.com", "domain": "Risk", "sub_domain": "Fraud", "ibs": True, "rto_hours": 1, "rpo_hours": 0.1, "cloud_service_type": "IAAS", "target_environment": "PRIVATE_CLOUD", "architecture_pattern": "EVENT_DRIVEN", "entry_point_url": "https://fraud.example.com", "ip": "198.51.100.30", "risk_band": "High", "support_group": "Risk Engineering"},
    {"ci_id": "CI-1005", "app_name": "Document Archive", "owner": "casey.morgan@example.com", "domain": "Operations", "sub_domain": "Records", "ibs": False, "rto_hours": 72, "rpo_hours": 24, "cloud_service_type": "NONE", "target_environment": "ON_PREM", "architecture_pattern": "MONOLITH", "entry_point_url": "https://archive.example.com", "ip": "203.0.113.5", "risk_band": "Low", "support_group": "Operations IT"},
    {"ci_id": "CI-1006", "app_name": "Mobile API Gateway", "owner": "taylor.chen@example.com", "domain": "Digital Channels", "sub_domain": "Mobile", "ibs": True, "rto_hours": 2, "rpo_hours": 0.5, "cloud_service_type": "PAAS", "target_environment": "PUBLIC_CLOUD", "architecture_pattern": "SERVERLESS", "entry_point_url": "https://mobile-api.example.com", "ip": "203.0.113.40", "risk_band": "Medium", "support_group": "Mobile Platform"},
    {"ci_id": "CI-1007", "app_name": "Regulatory Reporting Hub", "owner": "morgan.diaz@example.com", "domain": "Finance", "sub_domain": "Reporting", "ibs": True, "rto_hours": 8, "rpo_hours": 4, "cloud_service_type": "IAAS", "target_environment": "HYBRID", "architecture_pattern": "BATCH", "entry_point_url": "https://regreport.example.com", "ip": "192.0.2.77", "risk_band": "Medium", "support_group": "Finance Systems"},
    {"ci_id": "CI-1008", "app_name": "Internal Knowledge Assistant", "owner": "riley.kim@example.com", "domain": "Technology", "sub_domain": "Productivity", "ibs": False, "rto_hours": 24, "rpo_hours": 8, "cloud_service_type": "SAAS", "target_environment": "PUBLIC_CLOUD", "architecture_pattern": "MICROSERVICES", "entry_point_url": "https://assistant.example.com", "ip": "198.51.100.88", "risk_band": "Low", "support_group": "Developer Experience"},
]

PORTFOLIO = [
    {"portfolio_id": "PF-2001", "ci_id": "CI-1001", "investment_name": "Payments Modernisation", "investment_stage": "IN_DELIVERY", "funding_approved": True, "business_owner": "alex.rivera@example.com", "budget_band": "HIGH", "known_vendors": ["TokenVault Ltd"], "regulatory_notification_required": False},
    {"portfolio_id": "PF-2002", "ci_id": "CI-1002", "investment_name": "Digital Experience Uplift", "investment_stage": "IN_DELIVERY", "funding_approved": True, "business_owner": "sam.okafor@example.com", "budget_band": "MEDIUM", "known_vendors": ["IdentityCo"], "regulatory_notification_required": False},
    {"portfolio_id": "PF-2003", "ci_id": "CI-1003", "investment_name": "People Insights", "investment_stage": "FUNDED", "funding_approved": True, "business_owner": "priya.nair@example.com", "budget_band": "LOW", "known_vendors": ["AnalyticsCloud Inc"], "regulatory_notification_required": False},
    {"portfolio_id": "PF-2004", "ci_id": "CI-1004", "investment_name": "Fraud Analytics Programme", "investment_stage": "IN_DELIVERY", "funding_approved": True, "business_owner": "jordan.lee@example.com", "budget_band": "HIGH", "known_vendors": [], "regulatory_notification_required": False},
    {"portfolio_id": "PF-2005", "ci_id": "CI-1005", "investment_name": "Records Sustainment", "investment_stage": "BAU", "funding_approved": True, "business_owner": "casey.morgan@example.com", "budget_band": "LOW", "known_vendors": [], "regulatory_notification_required": False},
    {"portfolio_id": "PF-2006", "ci_id": "CI-1006", "investment_name": "Mobile Growth", "investment_stage": "FUNDED", "funding_approved": True, "business_owner": "taylor.chen@example.com", "budget_band": "HIGH", "known_vendors": ["PushNotify SA"], "regulatory_notification_required": False},
    {"portfolio_id": "PF-2007", "ci_id": "CI-1007", "investment_name": "Regulatory Change Book", "investment_stage": "IN_DELIVERY", "funding_approved": True, "business_owner": "morgan.diaz@example.com", "budget_band": "MEDIUM", "known_vendors": [], "regulatory_notification_required": True},
    {"portfolio_id": "PF-2008", "ci_id": "CI-1008", "investment_name": "Workplace Productivity", "investment_stage": "IDEA", "funding_approved": False, "business_owner": "riley.kim@example.com", "budget_band": "LOW", "known_vendors": ["ModelHost Corp"], "regulatory_notification_required": False},
]

ITSM_RISK = {
    "CI-1001": {"base_score": 62, "open_incidents": 3, "failed_changes_90d": 2},
    "CI-1002": {"base_score": 45, "open_incidents": 1, "failed_changes_90d": 1},
    "CI-1003": {"base_score": 18, "open_incidents": 0, "failed_changes_90d": 0},
    "CI-1004": {"base_score": 66, "open_incidents": 2, "failed_changes_90d": 1},
    "CI-1005": {"base_score": 12, "open_incidents": 0, "failed_changes_90d": 0},
    "CI-1006": {"base_score": 48, "open_incidents": 2, "failed_changes_90d": 0},
    "CI-1007": {"base_score": 40, "open_incidents": 1, "failed_changes_90d": 1},
    "CI-1008": {"base_score": 20, "open_incidents": 0, "failed_changes_90d": 0},
}

ARCH = {
    "CI-1001": {"capabilities": ["Card Authorisation", "Tokenisation", "Settlement"], "impact_level": "High", "dependencies": ["CI-1004"]},
    "CI-1002": {"capabilities": ["Customer Self-Service", "Identity"], "impact_level": "Medium", "dependencies": ["CI-1006"]},
    "CI-1003": {"capabilities": ["Workforce Analytics"], "impact_level": "Low", "dependencies": []},
    "CI-1004": {"capabilities": ["Fraud Detection", "Transaction Monitoring"], "impact_level": "High", "dependencies": ["CI-1001"]},
    "CI-1005": {"capabilities": ["Records Management"], "impact_level": "Low", "dependencies": []},
    "CI-1006": {"capabilities": ["Mobile Banking", "Notifications"], "impact_level": "Medium", "dependencies": ["CI-1002"]},
    "CI-1007": {"capabilities": ["Regulatory Reporting", "Finance Ledger"], "impact_level": "Medium", "dependencies": []},
    "CI-1008": {"capabilities": ["Knowledge Search"], "impact_level": "Low", "dependencies": []},
}

SECURITY_CONTROLS = [
    {"control": "SEC-01", "description": "Web application firewall and DDoS protection in front of public endpoints", "source_document": "Security Standard: Network Perimeter v3", "trigger": "internet_facing"},
    {"control": "SEC-02", "description": "Cardholder data environment segmentation and tokenisation", "source_document": "Security Standard: Payment Data v2", "trigger": "handles_payment_data"},
    {"control": "SEC-03", "description": "Strong customer authentication (MFA) for user access", "source_document": "Security Standard: Identity & Access v4", "trigger": "weak_auth"},
    {"control": "SEC-04", "description": "Encryption in transit using TLS 1.2+ for all interfaces", "source_document": "Security Standard: Cryptography v2", "trigger": "no_tls"},
    {"control": "SEC-05", "description": "Third-party security due diligence and contract clauses", "source_document": "Security Standard: Supplier Security v1", "trigger": "third_party"},
    {"control": "SEC-06", "description": "Independent penetration test prior to go-live", "source_document": "Security Standard: Assurance Testing v2", "trigger": "pen_test"},
    {"control": "SEC-07", "description": "Privileged access management with session recording", "source_document": "Security Standard: Identity & Access v4", "trigger": "privileged"},
]

ARCH_DOC = "Architecture Principles Handbook v5"


def sample(name: str, itype: str, ci: str, pf: str, sponsor: str, stage: str, created_days_ago: int, go_live_in_days: int, **flags: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "initiative_name": name, "initiative_type": itype, "application_ci_id": ci, "portfolio_id": pf,
        "sponsor_email": sponsor, "sponsor_name": sponsor.split("@")[0].replace(".", " ").title(),
        "business_unit": next(c["domain"] for c in CMDB if c["ci_id"] == ci),
        "current_stage": stage, "created_days_ago": created_days_ago, "go_live_in_days": go_live_in_days,
        "authentication_method": "SSO", "encryption_at_rest": True, "encryption_in_transit": True,
        "implementation_method": "AUTOMATED_PIPELINE", "data_classification": "INTERNAL", "lawful_basis": "NONE",
        "autonomy_level": "NONE", "ai_model_type": "NONE", "change_window": "AFTER_HOURS",
        "backout_plan_summary": "Redeploy previous release via pipeline rollback job.",
        "user_growth_pct": 5, "integration_count": 1, "secrets_management": "VAULT", "data_subjects_band": "NONE",
    }
    base.update(flags)
    return base


SAMPLES = [
    sample("Card Tokenisation Upgrade", "TECH_CHANGE", "CI-1001", "PF-2001", "alex.rivera@example.com", "Assessment", 14, 46,
           description="Upgrade card tokenisation library and rotate vault keys for the payments gateway.",
           internet_facing=True, handles_payment_data=True, data_classification="RESTRICTED", important_business_service=True,
           third_party_vendor_involved=True, vendor_name="TokenVault Ltd", penetration_test_planned=True, peak_tps=1800),
    sample("Archive Index Patch", "TECH_CHANGE", "CI-1005", "PF-2005", "casey.morgan@example.com", "Approval", 10, 50,
           description="Apply a vendor-neutral patch to the document archive search index with automated rollback.",
           user_growth_pct=0, integration_count=0),
    sample("Mobile Onboarding Revamp", "NEW_SERVICE", "CI-1006", "PF-2006", "taylor.chen@example.com", "Assessment", 60, 12,
           description="New mobile onboarding journey with identity verification and push notifications.",
           internet_facing=True, external_facing=True, personal_data_processed=True, lawful_basis="CONTRACT", data_classification="CONFIDENTIAL",
           data_subjects_band="LARGE", important_business_service=True, customer_impacting=True, outage_expected=True,
           outage_duration_minutes=45, customers_impacted_count=250000, disaster_recovery_required=True, authentication_method="MFA",
           user_growth_pct=40, sla_specified=True, new_pipeline_required=True, peak_tps=900),
    sample("Fraud Model Retraining", "AI_INITIATIVE", "CI-1004", "PF-2004", "jordan.lee@example.com", "Intake", 8, 52,
           description="Retrain the fraud classifier on new transaction features with semi-autonomous blocking.",
           ai_ml_component_present=True, autonomy_level="SEMI_AUTONOMOUS", ai_model_type="CLASSIFIER", human_in_the_loop=True,
           ai_decision_impacts_customers=True, personal_data_processed=True, training_data_contains_personal_data=True,
           lawful_basis="LEGITIMATE_INTEREST", data_classification="CONFIDENTIAL", important_business_service=True, peak_tps=2500),
    sample("HR Insights Dashboard", "CLOUD", "CI-1003", "PF-2003", "priya.nair@example.com", "Assessment", 5, 85,
           description="Move people analytics dashboards to a SaaS analytics provider in another region.",
           personal_data_processed=True, sensitive_personal_data_processed=True, cross_border_data_transfer=True,
           transfer_destinations="EU, US", lawful_basis="LEGITIMATE_INTEREST", data_classification="CONFIDENTIAL",
           data_subjects_band="MEDIUM", third_party_vendor_involved=True, vendor_name="AnalyticsCloud Inc", data_retention_months=36),
    sample("Regulatory Capital Report v2", "REGULATORY", "CI-1007", "PF-2007", "morgan.diaz@example.com", "Assessment", 20, 70,
           description="Implement updated regulatory capital reporting templates and submission workflow.",
           regulatory_notification_required=True, important_business_service=True, external_facing=True, integration_count=3,
           data_classification="CONFIDENTIAL"),
    sample("Knowledge Assistant Copilot", "AI_INITIATIVE", "CI-1008", "PF-2008", "riley.kim@example.com", "Build", 30, 60,
           description="Assistive LLM search over internal wiki content for engineers, human reviewed answers.",
           ai_ml_component_present=True, autonomy_level="ASSISTIVE", ai_model_type="LLM", human_in_the_loop=True),
    sample("Customer Portal Login MFA", "TECH_CHANGE", "CI-1002", "PF-2002", "sam.okafor@example.com", "Assessment", 12, 40,
           description="Introduce MFA step-up for the customer portal login journey.",
           internet_facing=True, external_facing=True, authentication_method="MFA", important_business_service=True,
           personal_data_processed=True, lawful_basis="CONTRACT", third_party_vendor_involved=True, vendor_name="IdentityCo",
           penetration_test_planned=True),
    sample("Payments DR Failover Test", "TECH_CHANGE", "CI-1001", "PF-2001", "alex.rivera@example.com", "Production", 90, -5,
           description="Scheduled disaster recovery failover rehearsal for the payments gateway.",
           disaster_recovery_required=True, important_business_service=True),
    sample("Biometric Branch Check-in", "AI_INITIATIVE", "CI-1002", "PF-2002", "sam.okafor@example.com", "Intake", 3, 120,
           description="Face recognition kiosk that autonomously checks customers in at branches.",
           ai_ml_component_present=True, autonomy_level="FULLY_AUTONOMOUS", ai_model_type="COMPUTER_VISION", biometric_data=True,
           ai_decision_impacts_customers=True, personal_data_processed=True, sensitive_personal_data_processed=True,
           lawful_basis="CONSENT", customer_impacting=True, third_party_vendor_involved=True, vendor_name="VisionKiosk GmbH"),
]


def write(name: str, payload: Any) -> None:
    (DATA_DIR / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    questions, coverage = build_questions()
    write("canonical_fields.json", {"version": 1, "enums": ENUMS, "fields": build_fields()})
    write("questions_master.json", {"version": 1, "questions": questions})
    write("question_coverage_map.json", coverage)
    write("mock_fixtures.json", {
        "version": 1, "cmdb": CMDB, "portfolio": PORTFOLIO, "itsm_risk": ITSM_RISK, "archportal": ARCH,
        "architecture_document": ARCH_DOC, "security_controls": SECURITY_CONTROLS, "sample_intakes": SAMPLES,
        "wiki_design_template_url": "https://wiki.example.com/templates/solution-design",
    })
    print(f"fields={len(FIELDS)} questions={len(questions)} samples={len(SAMPLES)}")


if __name__ == "__main__":
    main()
