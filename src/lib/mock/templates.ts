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
  /** Whether the deploy flow should offer an image upload (e.g. NFT collections). */
  requiresImage?: boolean;
  /** Wallet address of a community submitter. Built-in templates leave this unset;
   *  only the submitter may edit a user-submitted template. */
  submitter?: string;
  /** Epoch ms a community template was submitted. */
  createdAt?: number;
}

// Does the deploy flow show the image upload for this template? Community
// templates set the flag explicitly; built-ins default to NFT collections.
export function templateNeedsImage(t: Template): boolean {
  return t.requiresImage ?? t.category === "NFT";
}

// All sources are self-contained (NO imports) so they compile with the
// in-browser solc Web Worker, which cannot resolve npm/remote imports.

const ERC20_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(string memory name_, string memory symbol_, uint256 initialSupply_) {
        name = name_;
        symbol = symbol_;
        owner = msg.sender;
        uint256 supply = initialSupply_ * 10 ** decimals;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "ALLOWANCE");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "ZERO_ADDR");
        require(balanceOf[from] >= value, "BALANCE");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}`;

const ERC721_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

contract SimpleERC721 {
    string public name;
    string public symbol;
    string private baseURI;
    address public owner;
    uint256 public immutable maxSupply;
    uint256 public nextTokenId;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    constructor(string memory name_, string memory symbol_, string memory baseURI_, uint256 maxSupply_) {
        name = name_;
        symbol = symbol_;
        baseURI = baseURI_;
        maxSupply = maxSupply_;
        owner = msg.sender;
    }

    function mint(address to) external returns (uint256) {
        require(msg.sender == owner, "NOT_OWNER");
        require(nextTokenId < maxSupply, "SOLD_OUT");
        uint256 id = nextTokenId++;
        ownerOf[id] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, id);
        return id;
    }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf[tokenId];
        require(msg.sender == holder || isApprovedForAll[holder][msg.sender], "NOT_AUTHORIZED");
        getApproved[tokenId] = to;
        emit Approval(holder, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(ownerOf[tokenId] == from, "WRONG_FROM");
        require(to != address(0), "ZERO_ADDR");
        require(
            msg.sender == from || isApprovedForAll[from][msg.sender] || getApproved[tokenId] == msg.sender,
            "NOT_AUTHORIZED"
        );
        delete getApproved[tokenId];
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "") ==
                    IERC721Receiver.onERC721Received.selector,
                "UNSAFE_RECIPIENT"
            );
        }
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(ownerOf[tokenId] != address(0), "NOT_MINTED");
        return string(abi.encodePacked(baseURI, _toString(tokenId)));
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x80ac58cd || id == 0x01ffc9a7;
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { len--; b[len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}`;

const MULTISIG_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    mapping(address => bool) public isOwner;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    struct Tx { address to; uint256 value; bytes data; bool executed; uint256 confirmations; }
    Tx[] public txs;

    event Submit(uint256 indexed id);
    event Confirm(address indexed owner, uint256 indexed id);
    event Execute(uint256 indexed id);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "NOT_OWNER");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0 && _required > 0 && _required <= _owners.length, "BAD_CONFIG");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0) && !isOwner[_owners[i]], "BAD_OWNER");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        txs.push(Tx(to, value, data, false, 0));
        uint256 id = txs.length - 1;
        emit Submit(id);
        return id;
    }

    function confirm(uint256 id) external onlyOwner {
        require(!confirmed[id][msg.sender], "ALREADY");
        confirmed[id][msg.sender] = true;
        txs[id].confirmations++;
        emit Confirm(msg.sender, id);
    }

    function execute(uint256 id) external onlyOwner {
        Tx storage t = txs[id];
        require(t.confirmations >= required && !t.executed, "NOT_READY");
        t.executed = true;
        (bool ok, ) = t.to.call{value: t.value}(t.data);
        require(ok, "CALL_FAILED");
        emit Execute(id);
    }

    receive() external payable {}
}`;

const VESTING_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TokenVesting {
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable start;
    uint256 public immutable cliff;
    uint256 public immutable duration;
    uint256 public released;

    event Released(uint256 amount);

    constructor(address token_, address beneficiary_, uint256 cliffDays_, uint256 vestingDays_) {
        require(beneficiary_ != address(0), "ZERO_BENEFICIARY");
        require(vestingDays_ > 0, "ZERO_DURATION");
        token = IERC20(token_);
        beneficiary = beneficiary_;
        start = block.timestamp;
        cliff = block.timestamp + cliffDays_ * 1 days;
        duration = vestingDays_ * 1 days;
    }

    function vestedAmount() public view returns (uint256) {
        uint256 totalBalance = token.balanceOf(address(this)) + released;
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalBalance;
        return (totalBalance * (block.timestamp - start)) / duration;
    }

    function releasable() public view returns (uint256) {
        return vestedAmount() - released;
    }

    function release() external {
        uint256 amount = releasable();
        require(amount > 0, "NOTHING_VESTED");
        released += amount;
        require(token.transfer(beneficiary, amount), "TRANSFER_FAILED");
        emit Released(amount);
    }
}`;

const STAKING_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract SimpleStaking {
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    uint256 public immutable rewardRatePerBlock;
    address public owner;

    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateBlock;

    mapping(address => uint256) public staked;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    constructor(address stakingToken_, address rewardToken_, uint256 rewardRatePerBlock_) {
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        rewardRatePerBlock = rewardRatePerBlock_;
        owner = msg.sender;
        lastUpdateBlock = block.number;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((block.number - lastUpdateBlock) * rewardRatePerBlock * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (staked[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateBlock = block.number;
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
        _;
    }

    function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "ZERO");
        totalStaked += amount;
        staked[msg.sender] += amount;
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "TRANSFER_FAILED");
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(staked[msg.sender] >= amount, "BALANCE");
        totalStaked -= amount;
        staked[msg.sender] -= amount;
        require(stakingToken.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "NO_REWARD");
        rewards[msg.sender] = 0;
        require(rewardToken.transfer(msg.sender, reward), "TRANSFER_FAILED");
        emit RewardPaid(msg.sender, reward);
    }
}`;

const TIMELOCK_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TimelockController {
    uint256 public immutable minDelay;
    mapping(address => bool) public isProposer;
    mapping(address => bool) public isExecutor;
    mapping(bytes32 => uint256) public timestamps;

    event Scheduled(bytes32 indexed id, address target, uint256 value, uint256 readyAt);
    event Executed(bytes32 indexed id);

    constructor(uint256 minDelaySeconds, address[] memory proposers, address[] memory executors) {
        minDelay = minDelaySeconds;
        for (uint256 i = 0; i < proposers.length; i++) isProposer[proposers[i]] = true;
        for (uint256 i = 0; i < executors.length; i++) isExecutor[executors[i]] = true;
    }

    function hashOperation(address target, uint256 value, bytes calldata data, bytes32 salt)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(target, value, data, salt));
    }

    function schedule(address target, uint256 value, bytes calldata data, bytes32 salt, uint256 delay) external {
        require(isProposer[msg.sender], "NOT_PROPOSER");
        require(delay >= minDelay, "DELAY_TOO_SHORT");
        bytes32 id = hashOperation(target, value, data, salt);
        require(timestamps[id] == 0, "ALREADY_SCHEDULED");
        timestamps[id] = block.timestamp + delay;
        emit Scheduled(id, target, value, block.timestamp + delay);
    }

    function execute(address target, uint256 value, bytes calldata data, bytes32 salt) external payable {
        require(isExecutor[msg.sender], "NOT_EXECUTOR");
        bytes32 id = hashOperation(target, value, data, salt);
        uint256 ready = timestamps[id];
        require(ready != 0 && block.timestamp >= ready, "NOT_READY");
        timestamps[id] = 0;
        (bool ok, ) = target.call{value: value}(data);
        require(ok, "CALL_FAILED");
        emit Executed(id);
    }

    receive() external payable {}
}`;

const SOULBOUND_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SoulboundNFT {
    string public name;
    string public symbol;
    address public owner;
    uint256 public nextTokenId;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event Mint(address indexed to, uint256 indexed tokenId);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        owner = msg.sender;
    }

    function mint(address to) external returns (uint256) {
        require(msg.sender == owner, "NOT_OWNER");
        require(to != address(0), "ZERO_ADDR");
        uint256 id = nextTokenId++;
        ownerOf[id] = to;
        balanceOf[to] += 1;
        emit Mint(to, id);
        return id;
    }

    // Soulbound: tokens can never be transferred or approved once minted.
    function transferFrom(address, address, uint256) external pure {
        revert("SOULBOUND");
    }

    function approve(address, uint256) external pure {
        revert("SOULBOUND");
    }
}`;

const SPLITTER_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PaymentSplitter {
    address[] public payees;
    uint256 public totalShares;
    uint256 public totalReleased;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public released;

    event PaymentReceived(address from, uint256 amount);
    event PaymentReleased(address to, uint256 amount);

    constructor(address[] memory payees_, uint256[] memory shares_) {
        require(payees_.length == shares_.length && payees_.length > 0, "BAD_INPUT");
        for (uint256 i = 0; i < payees_.length; i++) {
            address account = payees_[i];
            uint256 sh = shares_[i];
            require(account != address(0) && sh > 0 && shares[account] == 0, "BAD_PAYEE");
            payees.push(account);
            shares[account] = sh;
            totalShares += sh;
        }
    }

    receive() external payable {
        emit PaymentReceived(msg.sender, msg.value);
    }

    function releasable(address account) public view returns (uint256) {
        uint256 totalReceived = address(this).balance + totalReleased;
        return (totalReceived * shares[account]) / totalShares - released[account];
    }

    function release(address account) external {
        require(shares[account] > 0, "NO_SHARES");
        uint256 payment = releasable(account);
        require(payment > 0, "NOT_DUE");
        released[account] += payment;
        totalReleased += payment;
        (bool ok, ) = payable(account).call{value: payment}("");
        require(ok, "TRANSFER_FAILED");
        emit PaymentReleased(account, payment);
    }
}`;

export const TEMPLATES: Template[] = [
  {
    id: "simple-erc20",
    name: "SimpleERC20",
    category: "Token Standards",
    description:
      "A standard ERC-20 fungible token with configurable name, symbol, total supply, owner-only minting, and public burning.",
    longDescription:
      "The most common starting point for any token project. Self-contained (no library imports) so it compiles and deploys directly. Compatible with every DEX, wallet, and indexer.",
    tags: ["ERC-20", "Mintable", "Burnable", "Ownable"],
    verified: true,
    deployCount: 0,
    solidity: ERC20_SRC,
    abi: '[{"inputs":[{"name":"name_","type":"string"},{"name":"symbol_","type":"string"},{"name":"initialSupply_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transfer","outputs":[{"type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],"name":"mint","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"amount","type":"uint256"}],"name":"burn","outputs":[],"stateMutability":"nonpayable","type":"function"}]',
    args: [
      {
        name: "name_",
        label: "Token Name",
        type: "string",
        placeholder: "e.g. My QIE Token",
        helper: "The full name of your token. This is permanent.",
      },
      {
        name: "symbol_",
        label: "Token Symbol",
        type: "string",
        placeholder: "e.g. MQT",
        maxLength: 8,
        uppercase: true,
        helper: "Ticker symbol. Conventionally 3-5 characters.",
      },
      {
        name: "initialSupply_",
        label: "Initial Supply",
        type: "uint",
        placeholder: "1000000",
        helper: "Whole tokens to mint at deploy. Contract handles 18 decimals.",
      },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 720000,
  },
  {
    id: "simple-erc721",
    name: "SimpleERC721",
    category: "NFT",
    description:
      "A standard ERC-721 collection with base URI, max supply cap, and owner-controlled sequential minting.",
    longDescription:
      "Self-contained ERC-721 ready for collections, identity tokens, or access passes. Sequential token IDs starting at 0, with safe-transfer receiver checks.",
    tags: ["ERC-721", "NFT", "Collection"],
    verified: true,
    deployCount: 0,
    solidity: ERC721_SRC,
    abi: '[{"inputs":[{"name":"name_","type":"string"},{"name":"symbol_","type":"string"},{"name":"baseURI_","type":"string"},{"name":"maxSupply_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"to","type":"address"}],"name":"mint","outputs":[{"type":"uint256"}],"stateMutability":"nonpayable","type":"function"}]',
    args: [
      { name: "name_", label: "Collection Name", type: "string", placeholder: "e.g. QIE Genesis" },
      {
        name: "symbol_",
        label: "Symbol",
        type: "string",
        placeholder: "QGEN",
        maxLength: 8,
        uppercase: true,
      },
      {
        name: "baseURI_",
        label: "Base URI",
        type: "string",
        placeholder: "ipfs://CID/",
        helper: "Token metadata base. Trailing slash recommended.",
      },
      { name: "maxSupply_", label: "Max Supply", type: "uint", placeholder: "10000" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 1100000,
  },
  {
    id: "multisig-wallet",
    name: "MultiSigWallet",
    category: "Governance",
    description:
      "A multi-signature wallet requiring M of N owner approvals to execute any transaction.",
    longDescription:
      "Secure treasury management for teams and DAOs. Each owner can submit and confirm transactions; execution requires the configured threshold.",
    tags: ["Multisig", "Treasury", "DAO"],
    verified: true,
    deployCount: 0,
    solidity: MULTISIG_SRC,
    abi: '[{"inputs":[{"name":"_owners","type":"address[]"},{"name":"_required","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"to","type":"address"},{"name":"value","type":"uint256"},{"name":"data","type":"bytes"}],"name":"submit","outputs":[{"type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"id","type":"uint256"}],"name":"confirm","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"id","type":"uint256"}],"name":"execute","outputs":[],"stateMutability":"nonpayable","type":"function"}]',
    args: [
      {
        name: "_owners",
        label: "Owners",
        type: "address[]",
        helper: "Addresses authorized to confirm transactions.",
      },
      {
        name: "_required",
        label: "Required Confirmations",
        type: "uint",
        placeholder: "2",
        helper: "Must be ≤ number of owners.",
      },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 980000,
  },
  {
    id: "token-vesting",
    name: "TokenVesting",
    category: "DeFi",
    description: "Linear token vesting with a configurable cliff and total vesting duration.",
    longDescription:
      "Fund this contract with an ERC-20 token; the beneficiary can claim a linearly-vesting amount after the cliff. Used for team allocations and investor unlocks.",
    tags: ["Vesting", "Token", "DeFi"],
    verified: true,
    deployCount: 0,
    solidity: VESTING_SRC,
    abi: '[{"inputs":[{"name":"token_","type":"address"},{"name":"beneficiary_","type":"address"},{"name":"cliffDays_","type":"uint256"},{"name":"vestingDays_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"release","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"releasable","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"}]',
    args: [
      { name: "token_", label: "Token Address", type: "address", placeholder: "0x..." },
      { name: "beneficiary_", label: "Beneficiary", type: "address", placeholder: "0x..." },
      { name: "cliffDays_", label: "Cliff (days)", type: "uint", placeholder: "180" },
      { name: "vestingDays_", label: "Vesting Duration (days)", type: "uint", placeholder: "1095" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 680000,
  },
  {
    id: "simple-staking",
    name: "SimpleStaking",
    category: "DeFi",
    description:
      "Single-asset staking. Users deposit an ERC-20 token and earn a second token as rewards per block.",
    longDescription:
      "Standard reward-per-token accounting with a configurable reward rate per block. Stake, withdraw, and claim rewards. Fund the contract with reward tokens before use.",
    tags: ["Staking", "Yield", "DeFi"],
    verified: true,
    deployCount: 0,
    solidity: STAKING_SRC,
    abi: '[{"inputs":[{"name":"stakingToken_","type":"address"},{"name":"rewardToken_","type":"address"},{"name":"rewardRatePerBlock_","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"amount","type":"uint256"}],"name":"stake","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"amount","type":"uint256"}],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"claimReward","outputs":[],"stateMutability":"nonpayable","type":"function"}]',
    args: [
      { name: "stakingToken_", label: "Staking Token", type: "address" },
      { name: "rewardToken_", label: "Reward Token", type: "address" },
      {
        name: "rewardRatePerBlock_",
        label: "Reward Rate / Block (wei)",
        type: "uint",
        placeholder: "1000000000000000000",
      },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 940000,
  },
  {
    id: "timelock-controller",
    name: "TimelockController",
    category: "Governance",
    description: "Enforces a mandatory delay between proposing and executing on-chain actions.",
    longDescription:
      "Proposers schedule operations that can only be executed after the minimum delay elapses. Used by DAOs to give token holders time to react before significant changes take effect.",
    tags: ["Timelock", "DAO", "Governance"],
    verified: true,
    deployCount: 0,
    solidity: TIMELOCK_SRC,
    abi: '[{"inputs":[{"name":"minDelaySeconds","type":"uint256"},{"name":"proposers","type":"address[]"},{"name":"executors","type":"address[]"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"target","type":"address"},{"name":"value","type":"uint256"},{"name":"data","type":"bytes"},{"name":"salt","type":"bytes32"},{"name":"delay","type":"uint256"}],"name":"schedule","outputs":[],"stateMutability":"nonpayable","type":"function"}]',
    args: [
      {
        name: "minDelaySeconds",
        label: "Min Delay (seconds)",
        type: "uint",
        placeholder: "172800",
      },
      { name: "proposers", label: "Proposers", type: "address[]" },
      { name: "executors", label: "Executors", type: "address[]" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 900000,
  },
  {
    id: "soulbound-nft",
    name: "SoulboundNFT",
    category: "NFT",
    description: "A non-transferable token. Once minted, it permanently belongs to the recipient.",
    longDescription:
      "Ideal for identity tokens, achievement badges, and reputation markers. All transfer and approval functions revert by design.",
    tags: ["Soulbound", "Identity", "Non-transferable"],
    verified: true,
    deployCount: 0,
    solidity: SOULBOUND_SRC,
    abi: '[{"inputs":[{"name":"name_","type":"string"},{"name":"symbol_","type":"string"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"to","type":"address"}],"name":"mint","outputs":[{"type":"uint256"}],"stateMutability":"nonpayable","type":"function"}]',
    args: [
      { name: "name_", label: "Name", type: "string", placeholder: "QIE Builder Badge" },
      {
        name: "symbol_",
        label: "Symbol",
        type: "string",
        maxLength: 8,
        uppercase: true,
        placeholder: "QBB",
      },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 620000,
  },
  {
    id: "payment-splitter",
    name: "PaymentSplitter",
    category: "Utility",
    description:
      "Automatically splits incoming native payments among recipients by configurable shares.",
    longDescription:
      "Pull-based: send native QIE to the contract, and each recipient claims their proportional share via release().",
    tags: ["Payment", "Splits", "Utility"],
    verified: true,
    deployCount: 0,
    solidity: SPLITTER_SRC,
    abi: '[{"inputs":[{"name":"payees_","type":"address[]"},{"name":"shares_","type":"uint256[]"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"name":"account","type":"address"}],"name":"release","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"account","type":"address"}],"name":"releasable","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"}]',
    args: [
      { name: "payees_", label: "Payees", type: "address[]" },
      { name: "shares_", label: "Shares (per payee)", type: "uint[]" },
    ],
    author: "DevStation",
    version: "1.0.0",
    estimatedGas: 760000,
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
    case "Token Standards":
      return "text-cat-token border-cat-token/40 bg-cat-token/10";
    case "DeFi":
      return "text-cat-defi border-cat-defi/40 bg-cat-defi/10";
    case "Governance":
      return "text-cat-gov border-cat-gov/40 bg-cat-gov/10";
    case "Utility":
      return "text-cat-util border-cat-util/40 bg-cat-util/10";
    case "NFT":
      return "text-cat-nft border-cat-nft/40 bg-cat-nft/10";
    case "Custom":
      return "text-cat-custom border-cat-custom/40 bg-cat-custom/10";
  }
}
