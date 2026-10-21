import { describe, expect, test } from "bun:test";
import { defaultDeployable, resolveContracts } from "./compiler";

const c = (bytecode: string) => ({
  abi: [],
  evm: { bytecode: { object: bytecode }, deployedBytecode: { object: bytecode } },
});

describe("resolveContracts", () => {
  test("keys by bare name when unique", () => {
    const out = resolveContracts({ "Token.sol": { Token: c("60") } });
    expect(Object.keys(out)).toEqual(["Token"]);
    expect(out.Token.qualifiedName).toBe("Token.sol:Token");
  });

  test("a name defined in two files keeps both, qualified", () => {
    const out = resolveContracts({
      "@openzeppelin/contracts/access/Ownable.sol": { Ownable: c("") },
      "Main.sol": { Ownable: c("60"), Main: c("61") },
    });
    expect(Object.keys(out).sort()).toEqual([
      "@openzeppelin/contracts/access/Ownable.sol:Ownable",
      "Main",
      "Main.sol:Ownable",
    ]);
  });
});

describe("defaultDeployable", () => {
  test("skips abstract contracts and prefers the user's own files", () => {
    const out = resolveContracts({
      "@openzeppelin/contracts/token/ERC20/ERC20.sol": { ERC20: c("") },
      "@openzeppelin/contracts/utils/Lib.sol": { Lib: c("6060") },
      "MyToken.sol": { IHelper: c(""), MyToken: c("6080") },
    });
    expect(defaultDeployable(out)).toBe("MyToken");
  });

  test("falls back to a library contract when the user wrote none deployable", () => {
    const out = resolveContracts({
      "@openzeppelin/contracts/utils/Lib.sol": { Lib: c("6060") },
      "I.sol": { I: c("") },
    });
    expect(defaultDeployable(out)).toBe("Lib");
    expect(defaultDeployable({})).toBe("");
  });
});
