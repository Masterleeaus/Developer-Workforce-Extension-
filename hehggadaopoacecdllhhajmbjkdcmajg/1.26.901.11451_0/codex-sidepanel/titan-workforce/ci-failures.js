export const CI_FAILURE_TYPES=Object.freeze([
 "LINT_FAILURE","TYPE_FAILURE","BUILD_FAILURE","UNIT_TEST_FAILURE","INTEGRATION_FAILURE",
 "COVERAGE_FAILURE","SECURITY_FAILURE","TENANT_ISOLATION_FAILURE","MIGRATION_FAILURE","RUNTIME_FAILURE","UNKNOWN_FAILURE"
]);
const RULES=[
 ["TENANT_ISOLATION_FAILURE",/tenant|cross[- ]company|company[_ -]?id|isolation/i],
 ["SECURITY_FAILURE",/security|vulnerab|permission|auth(?:n|z)?|secret/i],
 ["MIGRATION_FAILURE",/migration|schema|database upgrade/i],
 ["TYPE_FAILURE",/typecheck|type check|typescript|mypy|phpstan/i],
 ["LINT_FAILURE",/lint|eslint|ruff|flake8|phpcs/i],
 ["COVERAGE_FAILURE",/coverage|threshold/i],
 ["INTEGRATION_FAILURE",/integration|e2e|end[- ]to[- ]end/i],
 ["UNIT_TEST_FAILURE",/unit test|pytest|jest|vitest|phpunit|test failure/i],
 ["BUILD_FAILURE",/build|compile|bundl/i],
 ["RUNTIME_FAILURE",/runtime|browser|console|network|deploy|server/i]
];
export function classifyCIFailure(input={}){
 const text=[input.name,input.stage,input.message,input.log].filter(Boolean).join(" ");
 const found=RULES.find(([,re])=>re.test(text));
 return found?.[0]||"UNKNOWN_FAILURE";
}
export function recoveryRoute(type){
 const routes={
  LINT_FAILURE:"codex_builder",TYPE_FAILURE:"codex_builder",BUILD_FAILURE:"codex_builder",
  UNIT_TEST_FAILURE:"codex_builder",INTEGRATION_FAILURE:"codex_builder",COVERAGE_FAILURE:"codex_builder",
  SECURITY_FAILURE:"codex_orchestrator",TENANT_ISOLATION_FAILURE:"codex_orchestrator",
  MIGRATION_FAILURE:"codex_orchestrator",RUNTIME_FAILURE:"verification",UNKNOWN_FAILURE:"codex_orchestrator"
 };
 return routes[type]||"codex_orchestrator";
}
