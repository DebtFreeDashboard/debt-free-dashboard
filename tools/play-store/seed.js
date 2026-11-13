// Realistic sample plan for store screenshots. Generic names, no lender logos.
function ymd(d) { return d.toISOString().slice(0, 10); }
function back(months, day) { const d = new Date(Date.UTC(2026, 10 - months, day)); return ymd(d); }

const base = { realApr: null, regularApr: null, promoApr: null, promoEnd: null, postPromoApr: null,
  transferFee: 0, hasPromo: false, origPrincipal: null, termMonths: null, originationDate: null,
  dueDay2: null, issuer: null, creditLimit: null };
const debts = [
  { id: 1, name: 'Travel Rewards Card', type: 'cc', balance: 5840, apr: 24.99, minPayment: 160, dueDay: 18, creditLimit: 8000, loanType: 'revolving', includeInStrategy: true },
  { id: 2, name: 'Store Card', type: 'cc', balance: 1120, apr: 27.49, minPayment: 40, dueDay: 5, creditLimit: 1500, loanType: 'revolving', includeInStrategy: true },
  { id: 3, name: 'Balance Transfer Card', type: 'cc', balance: 3400, apr: 0, minPayment: 68, dueDay: 20, creditLimit: 5000, loanType: 'revolving', includeInStrategy: true,
    hasPromo: true, promoApr: 0, promoEnd: '2027-03-15', postPromoApr: 22.99 },
  { id: 4, name: 'Personal Loan', type: 'personal', balance: 6200, apr: 11.9, minPayment: 210, dueDay: 1, loanType: 'installment', includeInStrategy: true },
  { id: 5, name: 'Car Loan', type: 'auto', balance: 9850, apr: 6.49, minPayment: 340, dueDay: 22, loanType: 'installment', includeInStrategy: true,
    origPrincipal: 18500, termMonths: 60, originationDate: '2024-04-01' },
  { id: 6, name: 'Gas Card', type: 'cc', balance: 0, apr: 26.99, minPayment: 25, dueDay: 9, creditLimit: 1000, loanType: 'revolving', includeInStrategy: true }
].map(d => {
  const x = Object.assign({}, base, d);
  x.realApr = x.regularApr = x.hasPromo ? x.postPromoApr : x.apr;
  return x;
});

let pid = 100;
const P = (debtId, amount, date) => ({ id: pid++, debtId, debtName: debts.find(d => d.id === debtId).name, amount, date, eliminated: false });
const payments = [
  P(6, 300, back(4, 9)), P(4, 210, back(4, 1)), P(5, 340, back(4, 22)), P(1, 160, back(4, 18)), P(2, 140, back(4, 5)), P(3, 68, back(4, 20)),
  P(6, 300, back(3, 9)), P(4, 210, back(3, 1)), P(5, 340, back(3, 22)), P(1, 160, back(3, 18)), P(2, 140, back(3, 5)), P(3, 68, back(3, 20)),
  P(6, 300, back(2, 9)), P(4, 210, back(2, 1)), P(5, 340, back(2, 22)), P(1, 160, back(2, 18)), P(2, 140, back(2, 5)), P(3, 68, back(2, 20)),
  P(4, 210, back(1, 1)), P(5, 340, back(1, 22)), P(1, 160, back(1, 18)), P(2, 440, back(1, 5)), P(3, 68, back(1, 20)),
  P(4, 210, back(0, 1)), P(2, 140, back(0, 5))
];
// Gas Card eliminated on its last payment
payments.filter(p => p.debtId === 6).slice(-1)[0].eliminated = true;
debts.forEach(d => {
  const paid = payments.filter(p => p.debtId === d.id).reduce((s, p) => s + p.amount, 0);
  d.originalBalance = Math.round((d.balance + paid) * 100) / 100;
});

module.exports = { debts, payments };
