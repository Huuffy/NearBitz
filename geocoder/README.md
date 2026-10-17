# Geocoder (Photon)

GeoSales.ai turns company addresses into map coordinates with [Photon](https://github.com/komoot/photon),
an open-source geocoder backed by OpenStreetMap. It runs locally — no API key, no usage limits, no cost.

The jar and the India database (~1 GB) are **not committed**. Set them up once from the repo root.
You need Java 21+ to run it, and about 1.5 GB free disk during extraction.

**Windows (PowerShell — `curl.exe` and `tar` ship with Windows 10/11)**
```powershell
mkdir geocoder\photon_v1
cd geocoder\photon_v1
curl.exe -L -o photon-1.3.0.jar https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar
curl.exe -L -o photon-db-india.tar.bz2 https://download1.graphhopper.com/public/asia/india/photon-db-india-1.0-latest.tar.bz2
tar -xjf photon-db-india.tar.bz2
del photon-db-india.tar.bz2
```

**macOS / Linux**
```bash
mkdir -p geocoder/photon_v1 && cd geocoder/photon_v1
curl -L -o photon-1.3.0.jar https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar
curl -L -o photon-db-india.tar.bz2 https://download1.graphhopper.com/public/asia/india/photon-db-india-1.0-latest.tar.bz2
tar -xjf photon-db-india.tar.bz2      # Linux: needs bzip2 (apt install bzip2)
rm photon-db-india.tar.bz2
```

Optional integrity check: compare `md5sum photon-db-india.tar.bz2` (Windows: `certutil -hashfile photon-db-india.tar.bz2 MD5`)
with the `.md5` file published next to the download.

Expected layout:

```
geocoder/photon_v1/
├── photon-1.3.0.jar
└── photon_data/
```

`start.cmd` / `scripts/start.ps1` (Windows) and `scripts/start.sh` (macOS / Linux) start Photon automatically. By hand:

```bash
cd geocoder/photon_v1
java -Xmx3G -jar photon-1.3.0.jar serve -listen-ip 0.0.0.0 -listen-port 2322
```

Check it answers: `curl "http://localhost:2322/api?q=mumbai&limit=1"`.

Listening on `0.0.0.0` lets the API container reach it at `http://host.docker.internal:2322`.

> The database dump must match the Photon major version. Photon 1.x cannot read 0.x databases.
