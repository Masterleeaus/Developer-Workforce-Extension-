export const CI_FAILURE_TYPES=Object.freeze([
 "LINT_FAILURE","TYPE_FAILURE","BUILD_FAILURE","UNIT_TEST_FAILURE","INTEGRATION_FAILURE",
 "COVERAGE_FAILURE","DEPENDENCY_FAILURE","MIGRATION_FAILURE","SECURITY_FAILURE","TENANT_ISOLATION_FAILURE",
 "PACKAGING_FAILURE","RUNTIME_FAILURE","FLAKY_INFRASTRUCTURE","UNKNOWN_FAILURE"
]);
const RULES=[
 ["TENANT_ISOLATION_FAILURE",/tenant|cross[- ]company|company[_ -]?id|isolation/i],
 ["SECURITY_FAILURE",/security|vulnerab|permission|auth(?:n|z)?|secret/i],
 ["FLAKY_INFRASTRUCTURE",/flaky|runner|timeout|timed out|rate limit|network reset|service unavailable|infrastructure|github actions/i],
 ["DEPENDENCY_FAILURE",/dependency|dependencies|lockfile|package-lock|pnpm-lock|yarn.lock|npm (?:install|ci)|peer dep|resolution/i],
 ["PACKAGING_FAILURE",/packag|artifact|zip|manifest|upload-artifact|release bundle/i],
 ["MIGRATION_FAILURE",/migration|schema|database upgrade/i],
 ["TYPE_FAILURE",/typecheck|type check|typescript|mypy|phpstan/i],
 ["LINT_FAILURE",/lint|eslint|ruff|flake8|phpcs/i],
 ["COVERAGE_FAILURE",/coverage|threshold/i],
 ["INTEGRATION_FAILURE",/integration|e2e|end[- ]to[- ]end|acceptance/i],
 ["UNIT_TEST_FAILURE",/unit test|pytest|jest|vitest|phpunit|test failure/i],
 ["BUILD_FAILURE",/build|compile|bundl/i],
 ["RUNTIME_FAILURE",/runtime|browser|console|network|deploy|server/i]
];
export function classifyCIFailure(input={}){const text=[input.name,input.stage,input.message,input.log].filter(Boolean).join(" ");const found=RULES.find(([,re])=>re.test(text));return found?.[0]||"UNKNOWN_FAILURE"}
const ROUTES={
 LINT_FAILURE:{executionClass:"codex_builder",profiles:["code-quality"],repairKind:"code"},
 TYPE_FAILURE:{executionClass:"codex_builder",profiles:["typescript","code-quality"],repairKind:"code"},
 BUILD_FAILURE:{executionClass:"codex_builder",profiles:["build-system"],repairKind:"build"},
 UNIT_TEST_FAILURE:{executionClass:"codex_builder",profiles:["testing"],repairKind:"test"},
 INTEGRATION_FAILURE:{executionClass:"codex_builder",profiles:["integration-testing"],repairKind:"integration"},
 COVERAGE_FAILURE:{executionClass:"codex_builder",profiles:["testing"],repairKind:"test"},
 DEPENDENCY_FAILURE:{executionClass:"codex_builder",profiles:["dependency-management","build-system"],repairKind:"dependency"},
 PACKAGING_FAILURE:{executionClass:"codex_builder",profiles:["release-engineering","build-system"],repairKind:"packaging"},
 SECURITY_FAILURE:{executionClass:"codex_orchestrator",profiles:["security"],repairKind:"security"},
 TENANT_ISOLATION_FAILURE:{executionClass:"codex_orchestrator",profiles:["security","architecture"],repairKind:"architecture"},
 MIGRATION_FAILURE:{executionClass:"codex_orchestrator",profiles:["database","migration"],repairKind:"migration"},
 RUNTIME_FAILURE:{executionClass:"codex_builder",profiles:["runtime-verification"],repairKind:"runtime"},
 FLAKY_INFRASTRUCTURE:{executionClass:"work_supervisor",profiles:["ci-infrastructure"],repairKind:"retry-or-infrastructure"},
 UNKNOWN_FAILURE:{executionClass:"codex_orchestrator",profiles:["diagnostics"],repairKind:"triage"}
};
export function recoveryRoute(type){return ROUTES[type]?.executionClass||"codex_orchestrator"}
export function recoveryPlan(input={}){const type=input.type||classifyCIFailure(input),route=ROUTES[type]||ROUTES.UNKNOWN_FAILURE;return {type,...route,retryable:type==="FLAKY_INFRASTRUCTURE",evidence:{name:input.name||null,stage:input.stage||null,message:input.message||null,runId:input.runId||null,jobId:input.jobId||null,headSha:input.headSha||null}}}
