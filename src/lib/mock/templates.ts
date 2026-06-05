export type TemplateCategory =
  | "Token Standards"
  | "DeFi"
  | "Governance"
  | "Utility"
  | "NFT"
  | "Custom";

export interface ConstructorArg {
  name: string;
  label: string;
  type: "string" | "uint" | "address" | "bool" | "address[]" | "uint[]";
  placeholder?: string;
  helper?: string;
  maxLength?: number;
  uppercase?: boolean;
}

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  longDescription: string;
  tags: string[];
  verified: boolean;
  deployCount: number;
  solidity: string;
  abi: string;
  args: ConstructorArg[];
  author: string;
  version: string;
  estimatedGas: number;
}

const ERC20_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SimpleERC20 is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}`;

const ERC721_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SimpleERC721 is ERC721, Ownable {
    uint256 public nextTokenId;
    uint256 public immutable maxSupply;
    string private _baseTokenURI;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        _baseTokenURI = baseURI_;
        maxSupply = maxSupply_;
    }

    function mint(address to) external onlyOwner {
        require(nextTokenId < maxSupply, "SOLD_OUT");
        _safeMint(to, nextTokenId++);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}`;

const MULTISIG_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    struct Tx { address to; uint256 value; bytes data; bool executed; uint256 confirmations; }
    Tx[] public txs;

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0 && _required > 0 && _required <= _owners.length);
        owners = _owners;
        required = _required;
    }

    function submit(address to, uint256 value, bytes calldata data) external returns (uint256) {
        txs.push(Tx(to, value, data, false, 0));
        return txs.length - 1;
    }

    function confirm(uint256 id) external {
        require(!confirmed[id][msg.sender]);
        confirmed[id][msg.sender] = true;
        txs[id].confirmations++;
    }

    function execute(uint256 id) external {
        Tx storage t = txs[id];
        require(t.confirmations >= required && !t.executed);
        t.executed = true;
        (bool ok,) = t.to.call{value: t.value}(t.data);
        require(ok, "CALL_FAILED");
    }

    receive() external payable {}
}`;

export const TEMPLATES: Template[] = [
  {
    id: "simple-erc20",
    name: "SimpleERC20",
    category: "Token Standards",
    description:
      "A standard ERC-20 fungible token with configurable name, symbol, total supply, and optional minting capability.",
    longDescription:
      "The most common starting point for any token project. Includes minting (owner-only) and burning (anyone). Compatible with every DEX, wallet, and indexer.",
    tags: ["ERC-20", "Mintable", "Burnable", "Ownable"],
    verified: true,
    deployCount: 89,
    solidity: ERC20_SRC,
    abi: '[{"inputs":[{"name":"name_","type":"string"},{"name":"symbol_","type":"string"},{"name":"initialSupply_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"}]',
    args: [
      { name: "name_", label: "Token Name", type: "string", placeholder: "e.g. My QIE Token", helper: "The full name of your token. This is permanent." },
      { name: "symbol_", label: "Token Symbol", type: "string", placeholder: "e.g. MQT", maxLength: 8, uppercase: true, helper: "Ticker symbol. Conventionally 3-5 characters." },
      { name: "initialSupply_", label: "Initial Supply", type: "uint", placeholder: "1000000", helper: "Whole tokens to mint at deploy. Contract handles 18 decimals." },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1240000,
  },
  {
    id: "simple-erc721",
    name: "SimpleERC721",
    category: "NFT",
    description:
      "A standard ERC-721 collection with base URI, max supply cap, and owner-controlled minting.",
    longDescription:
      "Ready for collections, identity tokens, or access passes. Sequential token IDs starting at 0.",
    tags: ["ERC-721", "NFT", "Collection"],
    verified: true,
    deployCount: 54,
    solidity: ERC721_SRC,
    abi: '[{"inputs":[{"name":"name_","type":"string"},{"name":"symbol_","type":"string"},{"name":"baseURI_","type":"string"},{"name":"maxSupply_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"}]',
    args: [
      { name: "name_", label: "Collection Name", type: "string", placeholder: "e.g. QIE Genesis" },
      { name: "symbol_", label: "Symbol", type: "string", placeholder: "QGEN", maxLength: 8, uppercase: true },
      { name: "baseURI_", label: "Base URI", type: "string", placeholder: "ipfs://CID/", helper: "Token metadata base. Trailing slash recommended." },
      { name: "maxSupply_", label: "Max Supply", type: "uint", placeholder: "10000" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1850000,
  },
  {
    id: "multisig-wallet",
    name: "MultiSigWallet",
    category: "Governance",
    description: "A multi-signature wallet requiring M of N owner approvals to execute any transaction.",
    longDescription: "Secure treasury management for teams and DAOs. Each owner can submit and confirm transactions; execution requires the configured threshold.",
    tags: ["Multisig", "Treasury", "DAO"],
    verified: true,
    deployCount: 31,
    solidity: MULTISIG_SRC,
    abi: '[{"inputs":[{"name":"_owners","type":"address[]"},{"name":"_required","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"}]',
    args: [
      { name: "_owners", label: "Owners", type: "address[]", helper: "Addresses authorized to confirm transactions." },
      { name: "_required", label: "Required Confirmations", type: "uint", placeholder: "2", helper: "Must be ≤ number of owners." },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1620000,
  },
  {
    id: "token-vesting",
    name: "TokenVesting",
    category: "DeFi",
    description: "Linear token vesting with configurable cliff and vesting duration.",
    longDescription: "Beneficiaries claim tokens proportionally after the cliff. Used for team allocations and investor unlocks.",
    tags: ["Vesting", "Token", "DeFi"],
    verified: true,
    deployCount: 28,
    solidity: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract TokenVesting { /* ... linear vesting impl ... */ }`,
    abi: "[]",
    args: [
      { name: "token", label: "Token Address", type: "address", placeholder: "0x..." },
      { name: "beneficiary", label: "Beneficiary", type: "address", placeholder: "0x..." },
      { name: "cliffDays", label: "Cliff (days)", type: "uint", placeholder: "180" },
      { name: "vestingDays", label: "Vesting Duration (days)", type: "uint", placeholder: "1095" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 980000,
  },
  {
    id: "simple-staking",
    name: "SimpleStaking",
    category: "DeFi",
    description: "Single-asset staking. Users deposit ERC-20 tokens and earn rewards over time.",
    longDescription: "Configurable reward rate per block and minimum staking period.",
    tags: ["Staking", "Yield", "DeFi"],
    verified: true,
    deployCount: 41,
    solidity: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract SimpleStaking { /* ... staking impl ... */ }`,
    abi: "[]",
    args: [
      { name: "stakingToken", label: "Staking Token", type: "address" },
      { name: "rewardToken", label: "Reward Token", type: "address" },
      { name: "rewardRatePerBlock", label: "Reward Rate / Block", type: "uint", placeholder: "1000000000000000000" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1340000,
  },
  {
    id: "timelock-controller",
    name: "TimelockController",
    category: "Governance",
    description: "Enforces a mandatory delay between proposing and executing on-chain actions.",
    longDescription: "Used by DAOs to give token holders time to react before significant changes take effect.",
    tags: ["Timelock", "DAO", "Governance"],
    verified: true,
    deployCount: 19,
    solidity: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract TimelockController { /* ... */ }`,
    abi: "[]",
    args: [
      { name: "minDelaySeconds", label: "Min Delay (seconds)", type: "uint", placeholder: "172800" },
      { name: "proposers", label: "Proposers", type: "address[]" },
      { name: "executors", label: "Executors", type: "address[]" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1480000,
  },
  {
    id: "soulbound-nft",
    name: "SoulboundNFT",
    category: "NFT",
    description: "A non-transferable ERC-721 token. Once minted, it cannot be transferred.",
    longDescription: "Ideal for identity tokens, achievement badges, and reputation markers.",
    tags: ["ERC-721", "Soulbound", "Identity"],
    verified: true,
    deployCount: 37,
    solidity: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract SoulboundNFT { /* ... */ }`,
    abi: "[]",
    args: [
      { name: "name_", label: "Name", type: "string", placeholder: "QIE Builder Badge" },
      { name: "symbol_", label: "Symbol", type: "string", maxLength: 8, uppercase: true, placeholder: "QBB" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1410000,
  },
  {
    id: "payment-splitter",
    name: "PaymentSplitter",
    category: "Utility",
    description: "Automatically splits incoming payments among recipients by configurable shares.",
    longDescription: "Pull-based claiming. Each recipient claims their share proportional to their allocation.",
    tags: ["Payment", "Splits", "Utility"],
    verified: true,
    deployCount: 23,
    solidity: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract PaymentSplitter { /* ... */ }`,
    abi: "[]",
    args: [
      { name: "payees", label: "Payees", type: "address[]" },
      { name: "shares", label: "Shares (per payee)", type: "uint[]" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1100000,
  },
];

export function getTemplate(id: string) {
  return TEMPLATES.find((t) => t.id === id);
}

export const CATEGORIES: ("All" | TemplateCategory)[] = [
  "All",
  "Token Standards",
  "DeFi",
  "Governance",
  "Utility",
  "NFT",
  "Custom",
];

export function categoryColor(cat: TemplateCategory): string {
  switch (cat) {
    case "Token Standards": return "text-cat-token border-cat-token/40 bg-cat-token/10";
    case "DeFi": return "text-cat-defi border-cat-defi/40 bg-cat-defi/10";
    case "Governance": return "text-cat-gov border-cat-gov/40 bg-cat-gov/10";
    case "Utility": return "text-cat-util border-cat-util/40 bg-cat-util/10";
    case "NFT": return "text-cat-nft border-cat-nft/40 bg-cat-nft/10";
    case "Custom": return "text-cat-custom border-cat-custom/40 bg-cat-custom/10";
  }
}
