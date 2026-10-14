// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Sepolia-only utility token prototype. No production token economics are implied.
contract UCURRTest is ERC20, ERC20Capped, Ownable {
    constructor(address initialOwner)
        ERC20("Test CURR Utility", "uCURR")
        ERC20Capped(1_000_000_000 * 10 ** 18)
        Ownable(initialOwner)
    {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override(ERC20, ERC20Capped) {
        super._update(from, to, amount);
    }
}
