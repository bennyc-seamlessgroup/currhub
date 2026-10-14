// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Restricted test representation of shares. It confers no legal shareholder rights.
contract TCURRTest is ERC20, Ownable {
    mapping(address => bool) public allowlisted;
    event AllowlistUpdated(address indexed account, bool allowed);
    error NotAllowlisted(address account);

    constructor(address initialOwner)
        ERC20("Test CURR Shares", "tCURR")
        Ownable(initialOwner)
    {
        allowlisted[initialOwner] = true;
        emit AllowlistUpdated(initialOwner, true);
    }

    function decimals() public pure override returns (uint8) { return 0; }

    function setAllowlisted(address account, bool allowed) external onlyOwner {
        allowlisted[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (!allowlisted[to]) revert NotAllowlisted(to);
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && !allowlisted[from]) revert NotAllowlisted(from);
        if (to != address(0) && !allowlisted[to]) revert NotAllowlisted(to);
        super._update(from, to, amount);
    }
}
