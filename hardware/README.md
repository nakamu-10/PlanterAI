# ハードウェア

- `models/`：プランター筐体の3Dプリント用モデル。現在のモデルは `models/planter_ver2.stl`
- `firmware/planterai_firmware_oled/`：ESP32 のファームウェア（Arduino スケッチ、OLED 表示つき）
  - 書き込む前に `secrets.example.h` を `secrets.h` にコピーし、Wi-Fi・送信先 URL・デバイスキーを書く（`secrets.h` は git 管理外）
  - スケッチが読み込む `FrameMirror.h` はまだリポジトリにない
- `tools/`：開発用の Python ツール
  - `oled_mirror.py`：ESP32 の OLED 表示（128x64）を USB シリアルで受けて PC に拡大表示する
  - `test_parser.py`：`oled_mirror.py` のパーサのテスト
