"""Pre-flight email validation without sending messages."""

from __future__ import annotations

import re
from dataclasses import dataclass

import dns.resolver

from db_client import DatabaseClient

# A pragmatic RFC 5322-inspired expression. Full RFC parsing is intentionally
# avoided because quoted local parts and comments are poor outreach addresses.
EMAIL_PATTERN = re.compile(
    r"^(?=.{1,254}$)(?=.{1,64}@)"
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"[A-Za-z]{2,63}$"
)

DISPOSABLE_DOMAINS = frozenset(
    {
        "10minutemail.com",
        "guerrillamail.com",
        "maildrop.cc",
        "mailinator.com",
        "sharklasers.com",
        "tempmail.com",
        "throwawaymail.com",
        "yopmail.com",
    }
)
DISPOSABLE_MARKERS = ("10minute", "disposable", "guerrilla", "mailinator", "tempmail")


@dataclass(frozen=True)
class ValidationResult:
    status: str
    reason: str


def is_valid_syntax(email: str) -> bool:
    normalized = email.strip()
    if not EMAIL_PATTERN.fullmatch(normalized):
        return False
    local_part = normalized.rsplit("@", maxsplit=1)[0]
    return (
        not local_part.startswith(".")
        and not local_part.endswith(".")
        and ".." not in local_part
    )


def is_disposable_domain(domain: str) -> bool:
    normalized = domain.lower().rstrip(".")
    return normalized in DISPOSABLE_DOMAINS or any(
        marker in normalized for marker in DISPOSABLE_MARKERS
    )


def has_mx_records(
    domain: str,
    resolver: dns.resolver.Resolver | None = None,
) -> bool:
    dns_resolver = resolver or dns.resolver.Resolver()
    try:
        answers = dns_resolver.resolve(domain, "MX")
        # RFC 7505 null MX (exchange ".") explicitly means no email service.
        return any(str(answer.exchange).rstrip(".") for answer in answers)
    except (
        dns.resolver.NXDOMAIN,
        dns.resolver.NoAnswer,
    ):
        return False


def validate_email(email: str) -> ValidationResult:
    normalized = email.strip().lower()
    if not is_valid_syntax(normalized):
        return ValidationResult("invalid", "syntax")

    domain = normalized.rsplit("@", maxsplit=1)[1]
    if is_disposable_domain(domain):
        return ValidationResult("disposable", "disposable domain")
    if not has_mx_records(domain):
        return ValidationResult("invalid", "no MX record")
    return ValidationResult("valid", "passed")


def validate_lead_list(db: DatabaseClient) -> dict[str, int]:
    """Validate every unvalidated lead and persist each result independently."""

    counts = {"valid": 0, "invalid": 0, "disposable": 0, "errors": 0}
    for lead in db.get_unvalidated_leads():
        try:
            result = validate_email(str(lead.get("email", "")))
            db.update_lead_validation(str(lead["id"]), result.status)
            counts[result.status] += 1
        except Exception:
            # A transient database/DNS failure must not incorrectly invalidate a lead.
            counts["errors"] += 1
    return counts
