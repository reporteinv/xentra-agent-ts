#!/bin/bash
DATE=$(date +%Y%m%d_%H%M)
PROJECT_DIR="/var/www/xentra-agent-ts"
cd "$PROJECT_DIR"
SD_DIR="/media/backup_sd/backups-agent/backup_$DATE"
NVME_DIR="/home/orangepi/backups-nvme/backup_$DATE"
LOG="/var/www/xentra-agent-ts/backup.log"
ENV_FILE="/var/www/impresoras-ts/.env"

echo "$(date) — Iniciando backup xentra-agent-ts..." >> "$LOG"

# Crear directorios destino
mkdir -p "$SD_DIR" "$NVME_DIR"

# ── 1. ZIP del código xentra-agent-ts ──────────────────────────────────────
zip -r "$SD_DIR/codigo-agent.zip" \
  "$PROJECT_DIR/public" \
  "$PROJECT_DIR/src" \
  "$PROJECT_DIR/server.js" \
  "$PROJECT_DIR/package.json" \
  --exclude "*/node_modules/*" \
  --exclude "*/downloads/*" \
  -q
echo "$(date) — codigo-agent.zip OK" >> "$LOG"

# ── 2. Dump xentra_pcs_db desde Zero3 (remoto) ─────────────────────────────
mysqldump -h 192.168.0.10 -u xentra_remote -pxentra2026 xentra_pcs_db \
  > "$SD_DIR/xentra_pcs_db.sql" 2>> "$LOG"
gzip "$SD_DIR/xentra_pcs_db.sql"
echo "$(date) — xentra_pcs_db.sql.gz OK" >> "$LOG"

# ── 3. Incluir el exe del agente Go activo ──────────────────────────────────
if [ -f "$PROJECT_DIR/public/downloads/xentra-agent.exe" ]; then
  cp "$PROJECT_DIR/public/downloads/xentra-agent.exe" "$SD_DIR/xentra-agent.exe"
  echo "$(date) — xentra-agent.exe OK" >> "$LOG"
fi

# ── 4. Manifest ─────────────────────────────────────────────────────────────
echo "Backup xentra-agent-ts — $DATE" > "$SD_DIR/manifest.txt"
echo "" >> "$SD_DIR/manifest.txt"
for f in "$SD_DIR"/*; do
  fname=$(basename "$f")
  fsize=$(du -sh "$f" 2>/dev/null | cut -f1)
  sha=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)
  echo "$fname  $fsize  $sha" >> "$SD_DIR/manifest.txt"
done
echo "$(date) — manifest.txt OK" >> "$LOG"

# ── 5. Espejo en NVMe ───────────────────────────────────────────────────────
cp -r "$SD_DIR/." "$NVME_DIR/"
echo "$(date) — Espejo NVMe OK: $NVME_DIR" >> "$LOG"

# ── 6. ZIP total para adjuntar al correo ────────────────────────────────────
MAIL_ZIP="/tmp/backup-agent-$DATE.zip"
MAIL_STAGE="/tmp/mail-stage-$DATE"
mkdir -p "$MAIL_STAGE"
unzip -q "$SD_DIR/codigo-agent.zip" -d "$MAIL_STAGE" -x "*.bat*" "*.bak" "*.js"
cp "$SD_DIR/manifest.txt" "$SD_DIR/xentra_pcs_db.sql.gz" "$MAIL_STAGE/"
(cd "$MAIL_STAGE" && zip -r "$MAIL_ZIP" . -q)
rm -rf "$MAIL_STAGE"
echo "$(date) — ZIP correo OK" >> "$LOG"

# ── 7. Correo con ZIP adjunto ───────────────────────────────────────────────
SD_SIZE=$(du -sh "$SD_DIR" 2>/dev/null | cut -f1)
NVME_FREE=$(df -h /home/orangepi | awk 'NR==2{print $4}')
SD_FREE=$(df -h /media/backup_sd | awk 'NR==2{print $4}')

node -e "
require('dotenv').config({path: '$ENV_FILE'});
const nodemailer = require('nodemailer');
const fs = require('fs');
const t = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});
t.sendMail({
  from: 'Xentrasoft Backup <reporte@xentrasoft.com>',
  to: process.env.GMAIL_USER,
  subject: 'Backup xentra-agent-ts — $DATE',
  text: [
    'Backup completado exitosamente.',
    '',
    'Destinos:',
    '  SD:   /media/backup_sd/backups-agent/backup_$DATE  ($SD_SIZE)',
    '  NVMe: /home/orangepi/backups-nvme/backup_$DATE',
    '',
    'Espacio libre:',
    '  NVMe: $NVME_FREE disponible',
    '  SD:   $SD_FREE disponible',
    '',
    'Contenido del backup:',
    '  - codigo-agent.zip   (impresoras-ts + xentra-agent-ts)',
    '  - xentra_pcs_db.sql.gz',
    '  - xentra-agent.exe   (v5.2.1 activa)',
    '  - manifest.txt       (tamaños + SHA256)',
  ].join('\n'),
  attachments: [{
    filename: 'backup-agent-$DATE.zip',
    content: fs.readFileSync('$MAIL_ZIP')
  }]
}).then(() => {
  console.log('Email enviado');
  fs.unlinkSync('$MAIL_ZIP');
}).catch(e => {
  console.error('Error email:', e.message);
  fs.unlinkSync('$MAIL_ZIP');
});
" 2>> "$LOG"

echo "$(date) — Backup finalizado: SD=$SD_DIR NVMe=$NVME_DIR" >> "$LOG"
