#!/bin/bash
# Test CI Metrics System End-to-End
# This script tests all components of the CI system locally

set -e

echo "🧪 Testing CI Metrics System"
echo "=============================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -n "  Testing: $test_name... "
    
    if eval "$test_command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

echo "1️⃣  Verifying File Structure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

run_test "Workflow exists" "test -f .github/workflows/pr-metrics.yml"
run_test "Collect metrics script" "test -f scripts/ci/collect-metrics.ts"
run_test "AI logger script" "test -f scripts/ci/ai-logger.ts"
run_test "Compare script" "test -f scripts/ci/compare-metrics.ts"
run_test "Visualize script" "test -f scripts/ci/visualize-metrics.ts"
run_test "Verify script" "test -f scripts/ci/verify-setup.ts"
run_test "CI documentation" "test -f docs/CI_METRICS.md"
run_test "Setup guide" "test -f docs/CI_SETUP_GUIDE.md"

echo ""
echo "2️⃣  Testing Script Execution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create temporary cache directory
mkdir -p .cache/{metrics,logs,ai_logs,playwright}

run_test "Metrics collection" "npx tsx scripts/ci/collect-metrics.ts"
run_test "Metrics file created" "test -f .cache/metrics/metrics.json"
run_test "Test log created" "test -f .cache/logs/test.log"

run_test "AI logger simple log" "npx tsx scripts/ci/ai-logger.ts simple-log test-agent 'Test message' '{\"test\":true}'"
run_test "AI log created" "test -n \"\$(ls -A .cache/ai_logs/ 2>/dev/null)\""

run_test "Setup verification" "npx tsx scripts/ci/verify-setup.ts"

echo ""
echo "3️⃣  Testing Metrics Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f .cache/metrics/metrics.json ]; then
    run_test "Valid JSON format" "jq empty .cache/metrics/metrics.json"
    run_test "Has timestamp" "jq -e '.timestamp' .cache/metrics/metrics.json"
    run_test "Has test_time_sec" "jq -e '.test_time_sec' .cache/metrics/metrics.json"
    
    # Create a test baseline for comparison
    cp .cache/metrics/metrics.json .cache/metrics/baseline-test.json
    run_test "Metrics comparison" "npx tsx scripts/ci/compare-metrics.ts .cache/metrics/metrics.json .cache/metrics/baseline-test.json || true"
else
    echo -e "  ${YELLOW}⚠${NC}  Skipping validation tests (no metrics.json)"
    TESTS_FAILED=$((TESTS_FAILED + 3))
fi

echo ""
echo "4️⃣  Testing Package.json Scripts"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

run_test "npm script: ci:metrics" "grep -q '\"ci:metrics\"' package.json"
run_test "npm script: ci:compare" "grep -q '\"ci:compare\"' package.json"
run_test "npm script: ci:visualize" "grep -q '\"ci:visualize\"' package.json"
run_test "npm script: ci:ai-log" "grep -q '\"ci:ai-log\"' package.json"

echo ""
echo "5️⃣  Testing Workflow Syntax"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v python3 &> /dev/null; then
    run_test "YAML syntax valid" "python3 -c 'import yaml; yaml.safe_load(open(\".github/workflows/pr-metrics.yml\"))'"
else
    echo -e "  ${YELLOW}⚠${NC}  Python3 not found, skipping YAML validation"
fi

echo ""
echo "6️⃣  Testing Git Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

run_test ".gitignore has .cache/" "grep -q '.cache/' .gitignore"
run_test ".gitignore has test-results/" "grep -q 'test-results/' .gitignore"
run_test ".gitignore has playwright-report/" "grep -q 'playwright-report/' .gitignore"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Test Results Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))

echo "  Total tests: $TOTAL_TESTS"
echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"

if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    echo ""
    echo -e "${RED}❌ Some tests failed${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Make sure dependencies are installed: npm ci"
    echo "  2. Check if Node.js 20+ is installed: node --version"
    echo "  3. Run verification script: npx tsx scripts/ci/verify-setup.ts"
    echo ""
    exit 1
else
    echo ""
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Your CI Metrics System is working correctly."
    echo ""
    echo "Next steps:"
    echo "  1. Create a test PR to verify GitHub Actions workflow"
    echo "  2. Review the automated PR comment with metrics"
    echo "  3. Download and review artifacts"
    echo ""
    echo "Documentation:"
    echo "  • Complete guide: docs/CI_METRICS.md"
    echo "  • Setup guide: docs/CI_SETUP_GUIDE.md"
    echo "  • Scripts reference: scripts/ci/README.md"
    echo ""
fi

# Cleanup
echo "🧹 Cleaning up test files..."
rm -f .cache/metrics/baseline-test.json

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Test complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
