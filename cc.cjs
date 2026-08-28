const solc=require("solc"),fs=require("fs");
const src=fs.readFileSync(process.argv[2],"utf8"),name=process.argv[3];
const o=JSON.parse(solc.compile(JSON.stringify({language:"Solidity",sources:{[name+".sol"]:{content:src}},
 settings:{evmVersion:"shanghai",optimizer:{enabled:true,runs:200},outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}}})));
const errs=(o.errors||[]).filter(e=>e.severity==="error");
if(errs.length){console.log(errs.map(e=>e.formattedMessage).join("\n"));process.exit(1)}
const w=(o.errors||[]).filter(e=>e.severity==="warning");
const c=o.contracts[name+".sol"][name];
console.log(`  ${name}: ok — ${c.evm.bytecode.object.length/2} bytes, ${w.length} warning(s)`);
fs.writeFileSync(`/tmp/${name}.abi.json`,JSON.stringify(c.abi));
