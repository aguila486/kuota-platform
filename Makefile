# Atajos de desarrollo de Kuota (T031). Toda la lógica vive en scripts/dev/*.
BASE ?= main

.PHONY: up down test test-affected doctor

up: ## Arranca PostgreSQL, aplica migraciones y levanta el backend (espera /health/ready)
	scripts/dev/up.sh

down: ## Detiene el backend y PostgreSQL (conserva los datos)
	scripts/dev/down.sh

test: ## Pruebas de todos los componentes
	scripts/dev/test-all.sh

test-affected: ## Pruebas de los componentes afectados respecto a BASE (por defecto main)
	scripts/dev/test-affected.sh $(BASE)

doctor: ## Verifica las herramientas requeridas
	scripts/dev/doctor.sh
