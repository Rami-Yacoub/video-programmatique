#!/usr/bin/env python3
"""Renvoie le résultat du rendu à la Google Sheet (webhook Apps Script).

Variables d'environnement (secrets GitHub, jamais en clair dans le code) :
  WEBHOOK_URL    URL de la web app Apps Script
  WEBHOOK_TOKEN  jeton partagé vérifié côté Apps Script
Usage :
  post_result.py --run-id RUN-1 --out out/            (succès : envoie la vidéo)
  post_result.py --run-id RUN-1 --error "message"     (échec : met le statut à ERREUR)
"""
import argparse
import base64
import json
import os
import sys
from pathlib import Path

import requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--out")
    ap.add_argument("--error")
    args = ap.parse_args()

    body = {"token": os.environ["WEBHOOK_TOKEN"], "run_id": args.run_id}
    if args.error:
        body.update(status="ERREUR", message=args.error[:500])
    else:
        out = Path(args.out)
        meta = json.loads((out / "meta.json").read_text())
        body.update(status="OK", meta=meta,
                    video_b64=base64.b64encode((out / "video.mp4").read_bytes()).decode())
    # Apps Script répond par une redirection 302 : requests la suit, le POST est déjà traité.
    r = requests.post(os.environ["WEBHOOK_URL"], json=body, timeout=120)
    print("Webhook :", r.status_code, r.text[:200])
    if r.status_code >= 400:
        sys.exit(1)


if __name__ == "__main__":
    main()
