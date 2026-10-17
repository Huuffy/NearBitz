# GeoSales.ai — Docker management
# Usage: make <target>

.PHONY: up down restart logs shell-db shell-api migrate seed geocode status ps clean

## Start all services (dev mode with hot-reload)
up:
	docker compose up -d
	@echo ""
	@echo "  API  → http://localhost:3000"
	@echo "  DB   → localhost:5432  (postgres/postgres)"

## Stop all services
down:
	docker compose down

## Restart backend only (after Dockerfile change)
restart:
	docker compose up -d --build backend

## Follow logs
logs:
	docker compose logs -f

logs-api:
	docker compose logs -f backend

logs-db:
	docker compose logs -f postgres

## psql shell inside the DB container
shell-db:
	docker compose exec postgres psql -U postgres -d sales_app

## bash shell inside the API container
shell-api:
	docker compose exec backend sh

## Run all SQL migrations
migrate:
	docker compose exec backend npm run migrate

## Seed industries + product categories
seed:
	docker compose exec backend npm run seed

## Import MCA companies (CSV must be at backend/data/mca-company-master.csv)
import:
	docker compose exec backend npm run import:mca

## Import a single state for quick testing
import-state:
	docker compose exec backend node scripts/import-mca.js --state=Maharashtra --limit=5000

## Run geocoding queue
geocode:
	docker compose exec backend npm run geocode

## Full data pipeline (migrate → seed → import → geocode)
data:
	$(MAKE) migrate
	$(MAKE) seed
	$(MAKE) import
	$(MAKE) geocode

## Service status
status:
	docker compose ps

ps: status

## Remove containers + volumes (DELETES ALL DATA — use with caution)
clean:
	@echo "WARNING: This deletes all database data and uploads."
	@read -p "Type 'yes' to confirm: " c; [ "$$c" = "yes" ] || exit 1
	docker compose down -v
