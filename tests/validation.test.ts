import { validateRawReading } from "../supabase/functions/_shared/validation.ts";

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

const normal = { soil_adc: 2100, temp: 24, humidity: 55, lux: 2000 };

assert("正常なセンサー値を受理する", validateRawReading(normal).ok);
assert(
  "気温180.1℃を拒否する",
  !validateRawReading({ ...normal, temp: 180.1 }).ok,
);
assert(
  "湿度100%は受理する",
  validateRawReading({ ...normal, humidity: 100 }).ok,
);
assert(
  "湿度100%超を拒否する",
  !validateRawReading({ ...normal, humidity: 100.1 }).ok,
);
assert(
  "負の照度を拒否する",
  !validateRawReading({ ...normal, lux: -1 }).ok,
);
assert(
  "ADC範囲外を拒否する",
  !validateRawReading({ ...normal, soil_adc: 4096 }).ok,
);
assert(
  "必須項目の欠落を拒否する",
  !validateRawReading({ soil_adc: 2100, temp: 24, humidity: 55 }).ok,
);
assert(
  "任意の気圧を物理範囲内なら受理する",
  validateRawReading({ ...normal, pressure: 1013 }).ok,
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
