# Titan Mission Policy Profiles v0.1

Mission autonomy now adapts to operational risk.

Profiles:

## fast
Documentation/test-only style work.
- review every 5 passes
- up to 30 passes
- runtime verification optional by policy

## standard
Normal feature development.
- review every 5 passes
- 25 passes
- runtime verification expected

## sensitive
Payments, authority, execution, installer/server-sensitive work.
- review every 3 passes
- tighter budgets
- server verification required

## production
Production/deployment/security/auth/tenant/database/DirectAdmin/VPS work.
- review every 2 passes
- tightest budgets
- runtime + server verification required

`policy: "auto"` infers a profile locally from mission scope.
Explicit policy values: `fast`, `standard`, `sensitive`, `production`.

The profile is shown beside each worker in the cockpit.
