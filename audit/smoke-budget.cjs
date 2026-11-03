// Persistent request reservations: unknown/failed provider usage remains charged
// at its conservative allowance. This is not an AWS billing/credit ledger.
const fs = require('node:fs');
const path = require('node:path');
const micros = usd => Math.ceil(usd * 1000000);
function acquireBudgetLock(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'budget-running.lock');
  const fd = fs.openSync(file, 'wx');
  fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
  return () => fs.unlinkSync(file);
}
class SmokeBudget {
  constructor(file, limitUsd = 1) {
    this.file = file;
    if (!(limitUsd > 0 && limitUsd <= 1)) throw Error('Budget must be within the authorized USD 1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { version: 1, limitMicros: micros(limitUsd), entries: [] };
    if (this.state.version !== 1 || this.state.limitMicros !== micros(limitUsd) || !Array.isArray(this.state.entries)) throw Error('Invalid budget journal');
    this.save();
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2) + '\n'); }
  used(component) { return this.state.entries.filter(e => !component || e.component === component).reduce((s, e) => s + (e.actualMicros ?? e.reservedMicros), 0); }
  reserve(component, label, usd, componentLimit = 1) {
    const amount = micros(usd);
    if (!Number.isSafeInteger(amount) || amount <= 0 || this.used() + amount > this.state.limitMicros ||
      this.used(component) + amount > micros(componentLimit)) throw Error('BUDGET_LIMIT');
    if (this.state.entries.some(e => e.label === label)) throw Error('REQUEST_ALREADY_JOURNALED');
    const entry = { component, label, reservedMicros: amount, reservedAt: new Date().toISOString() };
    this.state.entries.push(entry); this.save(); return label;
  }
  settle(label, usd) {
    const entry = this.state.entries.find(e => e.label === label), amount = micros(usd);
    if (!entry || entry.actualMicros !== undefined || !Number.isSafeInteger(amount) || amount < 0) throw Error('Invalid settlement');
    if (amount > entry.reservedMicros) throw Error('PROVIDER_USAGE_EXCEEDED_ALLOWANCE');
    entry.actualMicros = amount; entry.settledAt = new Date().toISOString(); this.save();
  }
  summary() { return { limitUsd: this.state.limitMicros / 1000000, accountedUsd: this.used() / 1000000,
    unsettledRequests: this.state.entries.filter(e => e.actualMicros === undefined).length,
    note: 'Conservative request accounting; taxes, billing lag and unrelated traffic are not represented.' }; }
}
module.exports = { SmokeBudget, acquireBudgetLock };
