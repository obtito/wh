export const RECEIPT_ABI = [
  'function attester() view returns (address)',
  'function registerTask(bytes32 taskId, bytes32 inputHash, bytes32 policyHash)',
  'function recordReceipt(bytes32 taskId, bytes32 attemptId, address provider, bytes32 outputHash, bytes32 reportHash, uint8 verdict)',
  'function tasks(bytes32) view returns (address requester, bytes32 inputHash, bytes32 policyHash)',
  'function receipts(bytes32) view returns (bytes32 taskId, address provider, bytes32 outputHash, bytes32 reportHash, uint8 verdict)',
];
