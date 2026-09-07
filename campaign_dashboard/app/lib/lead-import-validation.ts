export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isThirdPartyEmailVerified(
  emailVerification?: string | null,
  thirdPartyFlag?: string | null,
) {
  const dedicatedFlag = normalizeVerification(thirdPartyFlag);
  if (dedicatedFlag) return isAffirmativeVerification(dedicatedFlag);
  return isAffirmativeVerification(normalizeVerification(emailVerification));
}

function isAffirmativeVerification(value: string) {
  if (!value) return false;
  if (
    value.startsWith("no ") ||
    value.startsWith("not ") ||
    value.startsWith("unverified") ||
    value === "false"
  ) {
    return false;
  }
  return (
    ["verified", "valid", "yes", "true"].includes(value) ||
    value.startsWith("yes verified") ||
    value.startsWith("verified by a third party") ||
    value.startsWith("third party verified")
  );
}

function normalizeVerification(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
