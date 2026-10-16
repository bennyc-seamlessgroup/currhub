export const profileCsvColumns = [
  ["Wallet", "wallet"], ["Name", "full_name"], ["Email", "email"],
  ["Company", "company"], ["Role", "role"], ["Country", "country"],
  ["Relationship", "relationship"], ["Marketing opt-in", "marketing_opt_in"],
  ["Updated at", "updated_at"],
];

export function csvCell(value) {
  let text = value == null ? "" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
  // Prevent spreadsheet formulas in stakeholder-supplied fields.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function profilesCsv(profiles) {
  const rows = [profileCsvColumns.map(([label]) => csvCell(label)).join(",")];
  for (const profile of profiles) rows.push(profileCsvColumns.map(([, key]) => csvCell(profile[key])).join(","));
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
