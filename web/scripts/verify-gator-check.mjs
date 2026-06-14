// Verifies the grant-permissions account diagnosis logic WITHOUT MetaMask.
//
// The live "internal accounts" rejection is MetaMask-side and can't be exercised
// headlessly, but the precheck that decides WHY a grant would be refused is pure:
//   1. getSmartAccountsEnvironment(84532).implementations.EIP7702StatelessDeleGatorImpl
//      must resolve to the canonical Base Sepolia gator.
//   2. delegatedImpl() must pull the impl out of an EIP-7702 designator and reject
//      non-7702 / empty code.
//   3. the isGator comparison must match only the gator designator.
//
// Run from web/:  node scripts/verify-gator-check.mjs

import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";

const BASE_SEPOLIA = 84532;
const EXPECTED_GATOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B";

// Mirror of grant-permissions/page.tsx delegatedImpl() — kept in lockstep.
function delegatedImpl(code) {
  if (!code || !code.toLowerCase().startsWith("0xef0100") || code.length < 48) return undefined;
  return `0x${code.slice(8, 48)}`;
}

let failed = 0;
function check(name, got, want) {
  const ok = String(got).toLowerCase() === String(want).toLowerCase();
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got:  ${got}\n        want: ${want}`}`);
  if (!ok) failed++;
}

// 1. Environment resolves the expected gator impl for Base Sepolia.
const gator = getSmartAccountsEnvironment(BASE_SEPOLIA).implementations.EIP7702StatelessDeleGatorImpl;
check("getSmartAccountsEnvironment(84532) gator impl", gator, EXPECTED_GATOR);

// 2/3. designator parsing + isGator over representative codes.
const gatorDesignator = `0xef0100${EXPECTED_GATOR.slice(2)}`;
const otherDesignator = `0xef0100${"00".repeat(19)}11`; // 7702 → some non-gator impl
const contractCode = "0x60806040" + "ab".repeat(40); // real deployed contract, not a 7702 designator

check("delegatedImpl(plain EOA '0x')", String(delegatedImpl("0x")), "undefined");
check("delegatedImpl(undefined)", String(delegatedImpl(undefined)), "undefined");
check("delegatedImpl(non-7702 contract code)", String(delegatedImpl(contractCode)), "undefined");
check("delegatedImpl(gator designator)", delegatedImpl(gatorDesignator), EXPECTED_GATOR);
check("delegatedImpl(other designator)", delegatedImpl(otherDesignator), `0x${"00".repeat(19)}11`);

const isGator = (code) => {
  const impl = delegatedImpl(code);
  return !!impl && impl.toLowerCase() === gator.toLowerCase();
};
check("isGator(gator designator)", isGator(gatorDesignator), "true");
check("isGator(other designator)", isGator(otherDesignator), "false");
check("isGator(plain EOA)", isGator("0x"), "false");

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
