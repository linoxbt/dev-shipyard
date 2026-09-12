// solc ships no types. The two scripts that use it are small and deliberate,
// and an ambient declaration is a better answer than putting them back outside
// the typechecker, which is the habit this project has already been bitten by.
declare module "solc" {
  const solc: {
    compile(input: string, callbacks?: { import?: (path: string) => unknown }): string;
    version(): string;
  };
  export default solc;
}
