// sha256 of each solc build the editor offers, pinned in this repository.
//
// The worker used to take the expected hash from bin/list.json on the same
// host as the compiler itself, which catches a corrupted download but not a
// compromised host: whoever can replace soljson can replace list.json too.
// These were recorded from binaries.soliditylang.org/bin/list.json on
// 2026-10-21; a version listed here must match its pin exactly. A version not
// listed here still loads, checked against list.json, and says so.
//
// To add a version: copy its "path" and "sha256" from bin/list.json.
export const SOLC_PINNED_SHA256: Record<string, { path: string; sha256: string }> = {
  "0.8.26": {
    path: "soljson-v0.8.26+commit.8a97fa7a.js",
    sha256: "db85e5396f523cc1a53c4c4d742e204f6dcba1a05842623d73be946809e11cd6",
  },
  "0.8.25": {
    path: "soljson-v0.8.25+commit.b61c2a91.js",
    sha256: "f8c9554471ff2db3843167dffb7a503293b5dc728c8305b044ef9fd37d626ca7",
  },
  "0.8.24": {
    path: "soljson-v0.8.24+commit.e11b9ed9.js",
    sha256: "11b054b55273ec55f6ab3f445eb0eb2c83a23fed43d10079d34ac3eabe6ed8b1",
  },
  "0.8.23": {
    path: "soljson-v0.8.23+commit.f704f362.js",
    sha256: "9c681b165c8647867589c0a5ecdc8692637a935928a2b1bbea2ff4a1f4976985",
  },
  "0.8.22": {
    path: "soljson-v0.8.22+commit.4fc1097e.js",
    sha256: "92d283c545395b91a656fa1ec94d567a464bca55aebcdbb99debf42b43026845",
  },
  "0.8.21": {
    path: "soljson-v0.8.21+commit.d9974bed.js",
    sha256: "45bea352b41d04039e19439962ddef1d3e10cf2bc9526feba39f2cc79e3c5a17",
  },
  "0.8.20": {
    path: "soljson-v0.8.20+commit.a1b79de6.js",
    sha256: "5c509f760dc110a695c8b39bbc21e08c17dee431aa14d606f59e623d7c3cc657",
  },
  "0.8.19": {
    path: "soljson-v0.8.19+commit.7dd6d404.js",
    sha256: "e0b74e0a16e783a35169f74d1a615ecb48d07c30f97346b83cd587949268681e",
  },
  "0.8.18": {
    path: "soljson-v0.8.18+commit.87f61d96.js",
    sha256: "d82bdcba2c386d60b33aca148a9cfdf097551f68c5e45d8ec01aebbafacf5075",
  },
  "0.8.17": {
    path: "soljson-v0.8.17+commit.8df45f5f.js",
    sha256: "617828e63be485c7cc2dbcbdd5a22b582b40fafaa41016ad595637b83c90656c",
  },
  "0.8.16": {
    path: "soljson-v0.8.16+commit.07a7930e.js",
    sha256: "27b2820ef93805a65c76b7945a49432582d306fd17a28985709a51e6403677c2",
  },
  "0.8.15": {
    path: "soljson-v0.8.15+commit.e14f2714.js",
    sha256: "71135e459d691767ce3453bab4564ef4a640dd50182da36517cbc1f96c1d4c7c",
  },
  "0.8.14": {
    path: "soljson-v0.8.14+commit.80d49f37.js",
    sha256: "7c3b3d0066fd381283b1d8d9a86153b2ddb5c01da14a1ae015c05cfa484e81b6",
  },
  "0.8.13": {
    path: "soljson-v0.8.13+commit.abaa5c0e.js",
    sha256: "387343bcf8f2b77fe4cdcddcaa84361fabf8e1c3508f874fbbcbb9c313542f56",
  },
  "0.8.12": {
    path: "soljson-v0.8.12+commit.f00d7308.js",
    sha256: "c2c4738c96ad329cbb9baea615ed50ffb5a53d93fed8e00785e47242581d3c60",
  },
  "0.8.11": {
    path: "soljson-v0.8.11+commit.d7f03943.js",
    sha256: "64117d4b13bfc5bc6e5f80823519b140e753a0c09e99edd756772dc3029bc1f8",
  },
  "0.8.10": {
    path: "soljson-v0.8.10+commit.fc410830.js",
    sha256: "5eaee3240a06891abf5ac70c75caf9a0c33ebe9a2736abdaa22a337f86c22933",
  },
  "0.8.9": {
    path: "soljson-v0.8.9+commit.e5eed63a.js",
    sha256: "5b25f987aae32a0275fdc6c1be36cc47cf126024a04dafd8e4be39a1d1d1422c",
  },
  "0.8.8": {
    path: "soljson-v0.8.8+commit.dddeac2f.js",
    sha256: "534b7d4079d13bb4cd10b7559dc105c2adec625df4105f20ebce47e6da60bfda",
  },
  "0.8.7": {
    path: "soljson-v0.8.7+commit.e28d00a7.js",
    sha256: "663ba99f7c7ee907f0f03227502d48a78256c3c292ace3b79a5d3eb510665306",
  },
  "0.8.6": {
    path: "soljson-v0.8.6+commit.11564f7e.js",
    sha256: "06a671efd8865a6ecc0ad648076177b35abcd06a7059888ea65111272e33a57f",
  },
  "0.8.4": {
    path: "soljson-v0.8.4+commit.c7e474f2.js",
    sha256: "4a14c7bcaf0d988a829db2174b8f7731898aa8633216490603ad74bff64eca3c",
  },
  "0.8.2": {
    path: "soljson-v0.8.2+commit.661d1103.js",
    sha256: "015e83fb0b72ccdafb0c217961b21a0321adb2d3f2ad992f5e79635c2086e6dd",
  },
  "0.8.0": {
    path: "soljson-v0.8.0+commit.c7dfd78e.js",
    sha256: "c596765f9b3dce486cf596ea35676f37124d54f3ada0fcbc02f094c392066a59",
  },
  "0.7.6": {
    path: "soljson-v0.7.6+commit.7338295f.js",
    sha256: "b94e69dfb056b3e26080f805ab43b668afbc0ac70bf124bfb7391ecfc0172ad2",
  },
  "0.7.5": {
    path: "soljson-v0.7.5+commit.eb77ed08.js",
    sha256: "2ee1c6434a32a40b137ac28be12ceeba64701bfad5e80239690803d9c139908e",
  },
  "0.7.4": {
    path: "soljson-v0.7.4+commit.3f05b770.js",
    sha256: "2b55ed5fec4d9625b6c7b3ab1abd2b7fb7dd2a9c68543bf0323db2c7e2d55af2",
  },
  "0.7.3": {
    path: "soljson-v0.7.3+commit.9bfce1f6.js",
    sha256: "caf4b1f3e01fcf946aad2d22bbe046b9dc4fd50049a05c3458ff239e2c93a785",
  },
  "0.7.2": {
    path: "soljson-v0.7.2+commit.51b20bc0.js",
    sha256: "dfa3f2bb4589bdc9c054292173c82ee70e65af8d1971598f6e13b9b79ba94185",
  },
  "0.7.1": {
    path: "soljson-v0.7.1+commit.f4a555be.js",
    sha256: "7fcc983c5149840a47b946fc51fc14f1c21cda07c01d650e4a1f814319cb1423",
  },
  "0.7.0": {
    path: "soljson-v0.7.0+commit.9e61f92b.js",
    sha256: "e7e1be3d0a67469f6a37cd676a22314c4faa8a22ff9d5ebde11302db754453eb",
  },
};
