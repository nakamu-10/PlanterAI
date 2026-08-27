import { readFile } from 'node:fs/promises'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'

const targetURL = process.argv[2] ?? 'https://planter-ai-zeta.vercel.app/'
const outputPath = process.argv[3] ?? 'docs/qr/PlanterAI_QR.png'

await QRCode.toFile(outputPath, targetURL, {
  type: 'png',
  width: 1200,
  margin: 4,
  errorCorrectionLevel: 'H',
  color: {
    dark: '#000000',
    light: '#FFFFFF',
  },
})

const png = PNG.sync.read(await readFile(outputPath))
const decoded = jsQR(
  new Uint8ClampedArray(png.data),
  png.width,
  png.height,
)

if (decoded?.data !== targetURL) {
  throw new Error(`QRコードの読み取り検証に失敗しました: ${decoded?.data ?? '読み取り不可'}`)
}

console.log(`Generated: ${outputPath}`)
console.log(`Decoded:   ${decoded.data}`)
