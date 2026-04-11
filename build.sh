#!/usr/bin/env bash
set -e

echo "🦀 Ferrobase Build Script"
echo "=========================="

# Check prerequisites
check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        echo "❌ '$1' not found. Please install it first."
        echo "   $2"
        exit 1
    fi
}

check_cmd "rustc" "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
check_cmd "node" "Install Node.js: https://nodejs.org"
check_cmd "npm" "Install Node.js: https://nodejs.org"

echo "✅ Prerequisites OK"
echo "   Rust: $(rustc --version)"
echo "   Node: $(node --version)"
echo ""

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Install Tauri CLI if needed
if ! npm list @tauri-apps/cli --depth=0 &> /dev/null; then
    echo "📦 Installing Tauri CLI..."
    npm install @tauri-apps/cli
fi

# Generate proper app icons (requires ImageMagick or sips on macOS)
if command -v sips &> /dev/null && [ -f "public/ferrobase.svg" ]; then
    echo "🎨 Generating app icons..."
    # Convert SVG to PNG using rsvg-convert or sips
    if command -v rsvg-convert &> /dev/null; then
        rsvg-convert -w 1024 -h 1024 public/ferrobase.svg -o /tmp/icon_1024.png
        sips -z 32 32 /tmp/icon_1024.png --out src-tauri/icons/32x32.png
        sips -z 128 128 /tmp/icon_1024.png --out src-tauri/icons/128x128.png
        sips -z 256 256 /tmp/icon_1024.png --out src-tauri/icons/128x128@2x.png
        # Create icns
        mkdir -p /tmp/ferrobase.iconset
        for size in 16 32 64 128 256 512; do
            sips -z $size $size /tmp/icon_1024.png --out /tmp/ferrobase.iconset/icon_${size}x${size}.png
            sips -z $((size*2)) $((size*2)) /tmp/icon_1024.png --out /tmp/ferrobase.iconset/icon_${size}x${size}@2x.png
        done
        iconutil -c icns /tmp/ferrobase.iconset -o src-tauri/icons/icon.icns
        echo "✅ Icons generated"
    fi
fi

# Build the application
echo ""
echo "🔨 Building Ferrobase..."
echo "   This may take 5-10 minutes on first build (compiling Rust dependencies)"
echo ""

npm run tauri build

echo ""
echo "✅ Build complete!"
echo ""

# Show output location
if [[ "$OSTYPE" == "darwin"* ]]; then
    DMG=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
    if [ -n "$DMG" ]; then
        echo "📦 macOS installer: $DMG"
        echo ""
        echo "To install: open '$DMG'"
    fi
fi
