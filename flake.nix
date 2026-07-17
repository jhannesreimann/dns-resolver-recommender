{
  description = "DNS Resolver Recommender development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

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
            buildInputs = with pkgs; [
              cargo
              rustc
              lld
              wasm-pack
              python3
              nodejs_22
              uv
            ];

            shellHook = ''
              alias build="cd src/wasm && wasm-pack build --target web && cd ../.."

              echo "DNS Resolver Recommender dev shell"
              echo "  build           wasm-pack build in src/wasm/"
              echo "  cd src/frontend && npm install && npm run dev"
              echo "  cd src/backend  && uv run dnsrr"
            '';
          };
        }
      );
    };
}
