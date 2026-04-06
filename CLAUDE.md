# CLAUDE.md — Project-Level Conventions

> Loaded automatically by Claude Code at the start of every conversation.

---

## 1. Auto Documentation Maintenance

### 1.1 Troubleshooting Log — `docs/troubleshooting.md`

**Trigger:** Automatically append an entry whenever any of the following occurs during a conversation:
- Bug / error investigation and resolution
- Configuration pitfall (env vars, build, dependencies, etc.)
- Expected vs. actual behavior mismatch
- Third-party API / service gotcha

**Format:** Follow the existing pattern — group by date, each entry has three sections: Symptom → Root Cause → Solution.

### 1.2 Architecture Doc — `docs/architecture.md`

**Trigger:** Update whenever any of the following changes occur:
- Module / service added, removed, or renamed
- Data flow or call chain modified
- API endpoint added or signature changed
- Core assumption changed (deployment model, dependencies, etc.)
- Signal priority adjusted

**Principle:** Keep ASCII diagrams consistent with prose descriptions.

### 1.3 README — `README.md`

**When:** At the end of each day's conversation (on user request or when code changes were made):
1. Update relevant README sections (features, structure, API, changelog, etc.)
2. Verify `docs/troubleshooting.md` includes any pitfalls encountered today
3. Verify `docs/architecture.md` reflects the current architecture

---

## 2. Production Redaction Rules

When production verification is involved, the following **must** be redacted:

### Prohibited Information
- **Page / site names:** No real names such as Taobao, Baidu, Ctrip, JD, Meituan, Pinduoduo, etc.
- **SOA service names:** No real serviceId, methodName, or endpoint paths
- **Business jargon:** No internal terms that could identify a specific business unit

### Replacement Strategy
| Real info | Redacted form |
|-----------|---------------|
| Specific page name | "an e-commerce page", "a travel page", "target page" |
| SOA service name | `xxxServiceName` / `xxxMethod` / `{serviceId}/{method}` |
| Specific URL | `https://example.com/...` |
| Business metrics | Use placeholders or vague descriptions |

### Scope
- Conversation output (replies to user)
- Code comments / commit messages
- README, troubleshooting, architecture, and all other docs
- Existing real info in history is left as-is; only **new** content must be redacted

---

## 3. Workflow Checklists

### Before ending a conversation
- [ ] Pitfalls encountered today? → `docs/troubleshooting.md` updated
- [ ] Architecture changed? → `docs/architecture.md` updated
- [ ] Code changed? → `README.md` sections synced

### Before committing code
- [ ] No real page names or SOA service names leaked
- [ ] No PII (phone numbers, emails, national IDs, etc.)
- [ ] `.env` / credentials not staged

---

## 4. Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-04-06 | Initial conventions: auto doc maintenance + production redaction rules |
