all:

@PHONY: webui-deps
webui-deps:
	cd desktop && npm install
	cd crates/librqbit/webui && npm install

@PHONY: webui-dev
webui-dev: webui-deps
	cd crates/librqbit/webui && \
	npm run dev

@PHONY: webui-build
webui-build: webui-deps
	cd crates/librqbit/webui && \
	npm run build

# NOTE: on LG TV using hostname is unstable for some reason, use IP address.
export RQBIT_UPNP_SERVER_HOSTNAME ?= $(shell hostname)
export RQBIT_UPNP_SERVER_FRIENDLY_NAME ?= rqbit-dev
export RQBIT_HTTP_API_LISTEN_ADDR ?= 0.0.0.0:3030
RQBIT_OUTPUT_FOLDER ?= /tmp/scratch
RQBIT_POSTGRES_CONNECTION_STRING ?= postgres:///rqbit

@PHONY: devserver-release
devserver-profile:
	cargo run --release -- server start $(RQBIT_OUTPUT_FOLDER)

# DEV variables (that's why defined after devserver-profile)
export RQBIT_LOG_FILE ?= /tmp/rqbit-log
export RQBIT_LOG_FILE_RUST_LOG ?= debug,librqbit=trace,upnp_serve=trace
export CORS_ALLOW_REGEXP ?= '.*'

@PHONY: devserver
devserver:
	echo -n '' > $(RQBIT_LOG_FILE) && \
	cargo run -- \
	server start $(RQBIT_OUTPUT_FOLDER)

@PHONY: devserver
devserver-postgres:
	echo -n '' > $(RQBIT_LOG_FILE) && \
	cargo run -- \
	server start --fastresume --persistence-location $(RQBIT_POSTGRES_CONNECTION_STRING) $(RQBIT_OUTPUT_FOLDER)

@PHONY: clean
clean:
	rm -rf target

@PHONY: sign-debug
sign-debug:
	codesign -f --entitlements resources/debugging.entitlements -s - target/debug/rqbit

@PHONY: sign-release
sign-release:
	codesign -f --entitlements resources/debugging.entitlements -s - target/release/rqbit

@PHONY: build-release
build-release:
	cargo build --release

@PHONY: install
install: build-release
	$(MAKE) build-release
	$(MAKE) sign-release
	install target/release/rqbit "$(HOME)/bin/"

@PHONY: release-macos-universal
release-macos-universal:
	cargo build --target aarch64-apple-darwin --profile release-github
	cargo build --target x86_64-apple-darwin --profile release-github
	lipo \
		./target/aarch64-apple-darwin/release-github/rqbit \
		./target/x86_64-apple-darwin/release-github/rqbit \
		-create \
		-output ./target/x86_64-apple-darwin/release-github/rqbit-osx-universal

@PHONY: release-linux-current-target
release-linux-current-target:
	CC_$(TARGET_SNAKE_CASE)=$(CROSS_COMPILE_PREFIX)-gcc \
	CXX_$(TARGET_SNAKE_CASE)=$(CROSS_COMPILE_PREFIX)-g++ \
	AR_$(TARGET_SNAKE_CASE)=$(CROSS_COMPILE_PREFIX)-ar \
	CARGO_TARGET_$(TARGET_SNAKE_UPPER_CASE)_LINKER=$(CROSS_COMPILE_PREFIX)-gcc \
	cargo build  --profile release-github --target=$(TARGET) --features=openssl-vendored

@PHONY: release-linux
release-linux: release-linux-x86_64 release-linux-aarch64 release-linux-armv6 release-linux-armv7 release-linux-armv7-musl

@PHONY: release-linux-x86_64
release-linux-x86_64:
	TARGET=x86_64-unknown-linux-musl \
	TARGET_SNAKE_CASE=x86_64_unknown_linux_musl \
	TARGET_SNAKE_UPPER_CASE=X86_64_UNKNOWN_LINUX_MUSL \
	CROSS_COMPILE_PREFIX=x86_64-unknown-linux-musl \
	$(MAKE) release-linux-current-target

@PHONY: docker-build-prereqs
docker-build-prereqs: release-linux-aarch64 release-linux-x86_64 release-linux-armv7

@PHONY: create-target-docker
create-target-docker:
	mkdir -p target/docker/linux/amd64 target/docker/linux/arm64 target/docker/linux/arm/v7 && \
	cp -lf target/x86_64-unknown-linux-musl/release-github/rqbit target/docker/linux/amd64/rqbit && \
	cp -lf target/aarch64-unknown-linux-musl/release-github/rqbit target/docker/linux/arm64/rqbit && \
	cp -lf target/armv7-unknown-linux-musleabihf/release-github/rqbit target/docker/linux/arm/v7/rqbit && \
	cp docker/Dockerfile target/Docker

@PHONY: docker-build
docker-build: create-target-docker
	docker build \
		-f target/docker/Dockerfile \
		-t ikatson/rqbit:$(shell git describe --tags) \
		--platform linux/amd64,linux/arm64,linux/arm/v7 \
		target/docker/

@PHONY: release-linux-aarch64
release-linux-aarch64:
	TARGET=aarch64-unknown-linux-musl \
	TARGET_SNAKE_CASE=aarch64_unknown_linux_musl \
	TARGET_SNAKE_UPPER_CASE=AARCH64_UNKNOWN_LINUX_MUSL \
	CROSS_COMPILE_PREFIX=aarch64-unknown-linux-musl \
	$(MAKE) release-linux-current-target

# TODO: couldn't figure out how to compile this one with musl
@PHONY: release-linux-armv6
release-linux-armv6:
	TARGET=arm-unknown-linux-gnueabihf \
	TARGET_SNAKE_CASE=arm_unknown_linux_gnueabihf \
	TARGET_SNAKE_UPPER_CASE=ARM_UNKNOWN_LINUX_GNUEABIHF \
	CROSS_COMPILE_PREFIX=arm-linux-gnueabihf \
	LDFLAGS=-latomic \
	$(MAKE) release-linux-current-target

@PHONY: release-linux-armv7
release-linux-armv7:
	TARGET=armv7-unknown-linux-musleabihf \
	TARGET_SNAKE_CASE=armv7_unknown_linux_musleabihf \
	TARGET_SNAKE_UPPER_CASE=ARMV7_UNKNOWN_LINUX_MUSLEABIHF \
	CROSS_COMPILE_PREFIX=armv7-linux-musleabihf \
	$(MAKE) release-linux-current-target


@PHONY: release-all
release-all: release-windows release-linux release-macos-universal
	rm -rf /tmp/rqbit-release
	mkdir -p /tmp/rqbit-release
	cp ./target/x86_64-pc-windows-gnu/release-github/rqbit.exe /tmp/rqbit-release
	cp ./target/x86_64-apple-darwin/release-github/rqbit-osx-universal /tmp/rqbit-release
	cp ./target/x86_64-unknown-linux-gnu/release-github/rqbit /tmp/rqbit-release/rqbit-linux-x86_64
	echo "The release was built in /tmp/rqbit-release"
