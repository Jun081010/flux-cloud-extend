FFmpeg bundled with the FluxDown Cloud share package
====================================================

Binaries:
  ffmpeg.exe
  ffprobe.exe

Version:
  ffmpeg 6.0-essentials_build (gyan.dev, 2023 build)

Why it is here:
  The FluxDown engine uses FFmpeg to mux separate DASH/HLS audio and video
  tracks (for example Bilibili and X videos) into one playable file. Without
  FFmpeg those downloads finish as two unplayable tracks.

Install location:
  The one-click installer copies both binaries to
  %LOCALAPPDATA%\FluxDownCloudExtension\ffmpeg\bin and adds that folder to the
  per-user PATH. It never writes into the FluxDown installation directory.

License:
  FFmpeg is licensed under the GNU General Public License v3.0 when built with
  --enable-gpl (this build enables x264/x265). Source code and build scripts:
    https://ffmpeg.org/
    https://www.gyan.dev/ffmpeg/builds/
  The full license text is available at https://www.gnu.org/licenses/gpl-3.0.txt

  This package redistributes the unmodified binaries. FluxDown Cloud itself is
  AGPL-3.0; see the LICENSE and THIRD_PARTY_NOTICES.md next to this folder.
