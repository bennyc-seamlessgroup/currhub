// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Sepolia test-token distributor. Each published round is immutable.
contract UCURRAirdrop is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Campaign {
        bytes32 root;
        uint256 total;
        uint256 paid;
        uint64 deadline;
        bool paused;
    }

    IERC20 public immutable token;
    uint256 public nextCampaignId = 1;
    uint256 public reserved;
    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event CampaignCreated(uint256 indexed campaignId, bytes32 root, uint256 total, uint64 deadline);
    event Claimed(uint256 indexed campaignId, address indexed account, uint256 amount);
    event CampaignPaused(uint256 indexed campaignId, bool paused);
    event CampaignClosed(uint256 indexed campaignId, uint256 returned);

    constructor(IERC20 rewardToken, address initialOwner) Ownable(initialOwner) {
        require(address(rewardToken) != address(0), "Invalid token");
        token = rewardToken;
    }

    function createCampaign(bytes32 root, uint256 total, uint64 deadline) external onlyOwner returns (uint256 id) {
        require(root != bytes32(0) && total > 0, "Empty campaign");
        require(deadline > block.timestamp, "Invalid deadline");
        require(token.balanceOf(address(this)) >= reserved + total, "Fund rewards first");
        id = nextCampaignId++;
        campaigns[id] = Campaign(root, total, 0, deadline, false);
        reserved += total;
        emit CampaignCreated(id, root, total, deadline);
    }

    function claim(uint256 id, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Campaign storage campaign = campaigns[id];
        require(campaign.root != bytes32(0), "Unknown campaign");
        require(!campaign.paused && block.timestamp <= campaign.deadline, "Claim unavailable");
        require(!claimed[id][msg.sender] && amount > 0, "Already claimed or ineligible");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        require(MerkleProof.verifyCalldata(proof, campaign.root, leaf), "Invalid allocation");
        claimed[id][msg.sender] = true;
        campaign.paid += amount;
        reserved -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    function setPaused(uint256 id, bool paused) external onlyOwner {
        require(campaigns[id].root != bytes32(0), "Unknown campaign");
        campaigns[id].paused = paused;
        emit CampaignPaused(id, paused);
    }

    function closeExpired(uint256 id, address recipient) external onlyOwner nonReentrant {
        Campaign storage campaign = campaigns[id];
        require(campaign.root != bytes32(0) && block.timestamp > campaign.deadline, "Not expired");
        require(recipient != address(0), "Invalid recipient");
        uint256 remaining = campaign.total - campaign.paid;
        campaign.total = campaign.paid;
        reserved -= remaining;
        token.safeTransfer(recipient, remaining);
        emit CampaignClosed(id, remaining);
    }
}
