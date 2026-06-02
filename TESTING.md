# Manual Smoke Test Checklist

## Single Transaction Share
- [ ] Share with full amount (no split) → badge appears
- [ ] Share with equal split → shares created 50/50
- [ ] Share with custom amounts → shares created as entered
- [ ] Share with non-co-group member → error shown
- [ ] Share transaction you don't own → error shown
- [ ] Share zero-amount transaction → error shown

## Multi-Selection Share
- [ ] Select 3 transactions → bulk share dialog opens
- [ ] Select different recipients per transaction → all shares created
- [ ] Missing recipient → validation error shown
- [ ] Custom amounts not summing → validation error shown

## Filter Views
- [ ] "All" shows all visible transactions
- [ ] "Mine" shows only own transactions
- [ ] "Shared with me" shows others' transactions where I have a share
- [ ] "Shared with others" shows my transactions that I shared

## Share Status Badge
- [ ] Shared transactions show "Shared" badge
- [ ] Non-shared transactions don't show badge
- [ ] Badge is visible in select mode and normal mode

## Settlement Flow
- [ ] Settlement shows original transaction context
- [ ] Settlement link navigates to original transaction
- [ ] Settlement when already settled shows warning
- [ ] Settlement when partially settled shows correct amount

## Edit/Delete with Shares
- [ ] Edit transaction with shares → shares rescaled
- [ ] Delete transaction with shares → shares CASCADE deleted
