{
  description = "Wasm-pack and Python development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      # Define the systems you want to support
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      # Helper function to generate outputs for all supported systems
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            # The packages you need in your environment
            buildInputs = with pkgs; [
              cargo
              rustc
              lld
              wasm-pack
              python3
            ];

            # A handy welcome message when you enter the shell
            shellHook = ''
              alias build="cd src/wasm && wasm-pack build --target web && cd ../.."
              alias server="python3 -m http.server 8000"

              echo "WebAssembly Dev Environment Loaded"
              echo "Available commands:"
              echo "  build   -> wasm-pack build in src/wasm/"
              echo "  server  -> python3 http.server on port 8000"
            '';
          };
        }
      );
    };
}
