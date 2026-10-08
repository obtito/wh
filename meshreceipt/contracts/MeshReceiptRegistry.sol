// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Records trusted-attester statements, not on-chain model correctness.
contract MeshReceiptRegistry {
    struct Task { address requester; bytes32 inputHash; bytes32 policyHash; }
    struct Receipt { bytes32 taskId; address provider; bytes32 outputHash; bytes32 reportHash; uint8 verdict; }
    address public immutable attester;
    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => Receipt) public receipts;

    event TaskRegistered(bytes32 indexed taskId, address indexed requester, bytes32 inputHash, bytes32 policyHash);
    event ReceiptRecorded(bytes32 indexed taskId, bytes32 indexed attemptId, address indexed provider, bytes32 outputHash, bytes32 reportHash, uint8 verdict);

    constructor(address attester_) { require(attester_ != address(0), "zero attester"); attester = attester_; }

    /// Registration shares the receipt authority; outsiders cannot reserve another task's ID.
    function registerTask(bytes32 taskId, bytes32 inputHash, bytes32 policyHash) external {
        require(msg.sender == attester, "not attester");
        require(taskId != bytes32(0) && inputHash != bytes32(0) && policyHash != bytes32(0), "empty commitment");
        require(tasks[taskId].requester == address(0), "task exists");
        tasks[taskId] = Task(msg.sender, inputHash, policyHash);
        emit TaskRegistered(taskId, msg.sender, inputHash, policyHash);
    }

    /// verdict: 1=PASS, 2=FAIL, 3=INCONCLUSIVE. Runtime ERROR is not a quality verdict.
    function recordReceipt(bytes32 taskId, bytes32 attemptId, address provider, bytes32 outputHash, bytes32 reportHash, uint8 verdict) external {
        require(msg.sender == attester, "not attester");
        require(tasks[taskId].requester != address(0), "unknown task");
        require(attemptId != bytes32(0) && receipts[attemptId].verdict == 0, "attempt exists or empty");
        require(provider != address(0) && outputHash != bytes32(0) && reportHash != bytes32(0), "empty receipt");
        require(verdict >= 1 && verdict <= 3, "invalid verdict");
        receipts[attemptId] = Receipt(taskId, provider, outputHash, reportHash, verdict);
        emit ReceiptRecorded(taskId, attemptId, provider, outputHash, reportHash, verdict);
    }
}
