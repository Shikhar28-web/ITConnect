using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace ITComputer.ScreenCapture;

public static class DxgiCapture
{
    private static IntPtr _d3dDevice = IntPtr.Zero;
    private static IntPtr _d3dContext = IntPtr.Zero;
    private static IDXGIOutputDuplication? _duplication;
    private static IntPtr _stagingTexture = IntPtr.Zero;
    private static int _width;
    private static int _height;
    private static bool _initialized;

    [DllImport("d3d11.dll", SetLastError = true)]
    private static extern int D3D11CreateDevice(
        IntPtr pAdapter,
        int driverType,
        IntPtr software,
        uint flags,
        IntPtr pFeatureLevels,
        uint featureLevels,
        uint sdkVersion,
        out IntPtr ppDevice,
        out int pFeatureLevel,
        out IntPtr ppImmediateContext);

    public static byte[]? TryCapture()
    {
        try
        {
            if (!_initialized)
            {
                Initialize();
            }

            return CaptureFrame();
        }
        catch
        {
            Reset();
            return null;
        }
    }

    private static void Initialize()
    {
        Reset();

        // 1. Create D3D11 Device and Context
        // Driver type hardware = 1
        int hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0, IntPtr.Zero, 0, 7, out _d3dDevice, out _, out _d3dContext);
        if (hr < 0) throw new Exception($"D3D11CreateDevice failed: {hr:X8}");

        // 2. Query IDXGIDevice from ID3D11Device
        Guid iidDxgiDevice = new("54ec77fa-1377-44e6-8c32-88fd4d44ee4c");
        hr = Marshal.QueryInterface(_d3dDevice, ref iidDxgiDevice, out IntPtr dxgiDevicePtr);
        if (hr < 0) throw new Exception("QueryInterface IDXGIDevice failed");
        var dxgiDevice = (IDXGIDevice)Marshal.GetObjectForIUnknown(dxgiDevicePtr);
        Marshal.Release(dxgiDevicePtr);

        // 3. Get Parent Adapter
        hr = dxgiDevice.GetParent(new Guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0"), out IntPtr adapterPtr);
        if (hr < 0) throw new Exception("GetParent IDXGIAdapter failed");
        var adapter = (IDXGIAdapter)Marshal.GetObjectForIUnknown(adapterPtr);
        Marshal.Release(adapterPtr);

        // 4. Enum Outputs (Get primary screen)
        hr = adapter.EnumOutputs(0, out IntPtr outputPtr);
        if (hr < 0) throw new Exception("EnumOutputs IDXGIOutput failed");
        var output = (IDXGIOutput)Marshal.GetObjectForIUnknown(outputPtr);
        Marshal.Release(outputPtr);

        // 5. Query IDXGIOutput1 from IDXGIOutput
        Guid iidDxgiOutput1 = new("00cddea8-939b-4b83-a340-a685226666cc");
        hr = Marshal.QueryInterface(Marshal.GetIUnknownForObject(output), ref iidDxgiOutput1, out IntPtr output1Ptr);
        if (hr < 0) throw new Exception("QueryInterface IDXGIOutput1 failed");
        var output1 = (IDXGIOutput1)Marshal.GetObjectForIUnknown(output1Ptr);
        Marshal.Release(output1Ptr);

        // 6. Duplicate Output
        hr = output1.DuplicateOutput(_d3dDevice, out IntPtr duplicationPtr);
        if (hr < 0) throw new Exception($"DuplicateOutput failed: {hr:X8}");
        _duplication = (IDXGIOutputDuplication)Marshal.GetObjectForIUnknown(duplicationPtr);
        Marshal.Release(duplicationPtr);

        // 7. Get Output Description to determine size
        _duplication.GetDesc(out var duplDesc);
        _width = duplDesc.ModeDesc.Width;
        _height = duplDesc.ModeDesc.Height;

        // 8. Create staging texture
        CreateStagingTexture();

        _initialized = true;
    }

    private static void CreateStagingTexture()
    {
        D3D11_TEXTURE2D_DESC desc = new()
        {
            Width = (uint)_width,
            Height = (uint)_height,
            MipLevels = 1,
            ArraySize = 1,
            Format = 28, // DXGI_FORMAT_R8G8B8A8_UNORM
            SampleDesc = new DXGI_SAMPLE_DESC { Count = 1, Quality = 0 },
            Usage = 3, // D3D11_USAGE_STAGING
            BindFlags = 0,
            CPUAccessFlags = 0x20000, // D3D11_CPU_ACCESS_READ
            MiscFlags = 0
        };

        Guid iidD3D11Device = new("db6f6ddb-ac77-4e88-8253-819df9bbf140");
        var device = (ID3D11Device)Marshal.GetObjectForIUnknown(Marshal.GetIUnknownForObject(Marshal.GetObjectForIUnknown(_d3dDevice)));
        
        int hr = device.CreateTexture2D(ref desc, IntPtr.Zero, out _stagingTexture);
        if (hr < 0) throw new Exception($"CreateTexture2D staging failed: {hr:X8}");
    }

    private static byte[] CaptureFrame()
    {
        if (_duplication == null || _d3dContext == IntPtr.Zero || _stagingTexture == IntPtr.Zero)
            throw new Exception("CaptureFrame called before initialization");

        int hr = _duplication.AcquireNextFrame(250, out var frameInfo, out var desktopResourcePtr);
        if (hr < 0)
        {
            if (hr == unchecked((int)0x887A0027)) // DXGI_ERROR_WAIT_TIMEOUT
            {
                // No frame change, return empty to not send duplicate frames
                return Array.Empty<byte>();
            }
            throw new Exception($"AcquireNextFrame failed: {hr:X8}");
        }

        IntPtr texture2DPtr = IntPtr.Zero;
        try
        {
            Guid iidTexture2D = new("6f15aaf2-d20d-4a89-9ab4-4e34f3c22db3");
            hr = Marshal.QueryInterface(desktopResourcePtr, ref iidTexture2D, out texture2DPtr);
            if (hr < 0) throw new Exception("QueryInterface ID3D11Texture2D failed");

            // Copy to staging texture
            var context = (ID3D11DeviceContext)Marshal.GetObjectForIUnknown(_d3dContext);
            context.CopyResource(_stagingTexture, texture2DPtr);

            // Map staging texture
            D3D11_MAPPED_SUBRESOURCE mappedSubresource = new();
            hr = context.Map(_stagingTexture, 0, 1 /*D3D11_MAP_READ*/, 0, ref mappedSubresource);
            if (hr < 0) throw new Exception($"Map texture failed: {hr:X8}");

            byte[] jpegBytes;
            try
            {
                using (Bitmap bmp = new(_width, _height, mappedSubresource.RowPitch, PixelFormat.Format32bppArgb, mappedSubresource.pData))
                {
                    using (MemoryStream ms = new())
                    {
                        ImageCodecInfo? jpgEncoder = GetEncoder(ImageFormat.Jpeg);
                        if (jpgEncoder != null)
                        {
                            Encoder myEncoder = Encoder.Quality;
                            EncoderParameters myEncoderParameters = new(1);
                            EncoderParameter myEncoderParameter = new(myEncoder, 60L); // Quality 60
                            myEncoderParameters.Param[0] = myEncoderParameter;
                            bmp.Save(ms, jpgEncoder, myEncoderParameters);
                            jpegBytes = ms.ToArray();
                        }
                        else
                        {
                            jpegBytes = Array.Empty<byte>();
                        }
                    }
                }
            }
            finally
            {
                context.Unmap(_stagingTexture, 0);
            }

            return jpegBytes;
        }
        finally
        {
            if (texture2DPtr != IntPtr.Zero) Marshal.Release(texture2DPtr);
            Marshal.Release(desktopResourcePtr);
            _duplication.ReleaseFrame();
        }
    }

    private static ImageCodecInfo? GetEncoder(ImageFormat format)
    {
        ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
        foreach (ImageCodecInfo codec in codecs)
        {
            if (codec.FormatID == format.Guid) return codec;
        }
        return null;
    }

    public static void Reset()
    {
        _initialized = false;
        if (_stagingTexture != IntPtr.Zero)
        {
            Marshal.Release(_stagingTexture);
            _stagingTexture = IntPtr.Zero;
        }
        if (_duplication != null)
        {
            Marshal.ReleaseComObject(_duplication);
            _duplication = null;
        }
        if (_d3dContext != IntPtr.Zero)
        {
            Marshal.Release(_d3dContext);
            _d3dContext = IntPtr.Zero;
        }
        if (_d3dDevice != IntPtr.Zero)
        {
            Marshal.Release(_d3dDevice);
            _d3dDevice = IntPtr.Zero;
        }
    }

    // COM Interfaces and Structs for DXGI / D3D11
    [ComImport]
    [Guid("47c73127-ef9f-4cc3-abac-437d777407bc")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIObject
    {
        [PreserveSig] int SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] int SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] int GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr ppParent);
    }

    [ComImport]
    [Guid("54ec77fa-1377-44e6-8c32-88fd4d44ee4c")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIDevice
    {
        [PreserveSig] int SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] int SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] int GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr ppParent);
        [PreserveSig] int GetAdapter(out IntPtr pAdapter);
    }

    [ComImport]
    [Guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIAdapter
    {
        [PreserveSig] int SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] int SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] int GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr ppParent);
        [PreserveSig] int EnumOutputs(uint Output, out IntPtr ppOutput);
    }

    [ComImport]
    [Guid("ae02fed0-ad8d-4be0-80d4-03f287ff604b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIOutput
    {
        [PreserveSig] int SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] int SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] int GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr ppParent);
        [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC pDesc);
    }

    [ComImport]
    [Guid("00cddea8-939b-4b83-a340-a685226666cc")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIOutput1
    {
        [PreserveSig] int SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] int SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] int GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr ppParent);
        [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC pDesc);
        [PreserveSig] int GetDisplayModeList(int Format, uint Flags, ref uint pNumModes, IntPtr pDesc);
        [PreserveSig] int FindClosestMatchingMode(IntPtr pModeToMatch, IntPtr pClosestMatch, IntPtr pConcernDevice);
        [PreserveSig] int WaitForVBlank();
        [PreserveSig] int TakeOwnership(IntPtr pDevice, bool Exclusive);
        [PreserveSig] int ReleaseOwnership();
        [PreserveSig] int GetGammaControlCapabilities(IntPtr pGammaCaps);
        [PreserveSig] int SetGammaControl(IntPtr pGammaControl);
        [PreserveSig] int GetGammaControl(IntPtr pGammaControl);
        [PreserveSig] int SetDisplaySurface(IntPtr pScanoutSurface);
        [PreserveSig] int GetDisplaySurfaceData(IntPtr pDestination);
        [PreserveSig] int GetFrameStatistics(IntPtr pStats);
        [PreserveSig] int GetDisplayModeList1(int Format, uint Flags, ref uint pNumModes, IntPtr pDesc);
        [PreserveSig] int FindClosestMatchingMode1(IntPtr pModeToMatch, IntPtr pClosestMatch, IntPtr pConcernDevice);
        [PreserveSig] int GetDisplaySurfaceData1(IntPtr pDestination);
        [PreserveSig] int DuplicateOutput(IntPtr pDevice, out IntPtr ppOutputDuplication);
    }

    [ComImport]
    [Guid("191cfac3-a341-470d-b26e-a864f428319c")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIOutputDuplication
    {
        [PreserveSig] int SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] int SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] int GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr ppParent);
        [PreserveSig] int GetDesc(out DXGI_OUTDUPL_DESC pDesc);
        [PreserveSig] int AcquireNextFrame(uint TimeoutInMilliseconds, out DXGI_OUTDUPL_FRAME_INFO pFrameInfo, out IntPtr ppDesktopResource);
        [PreserveSig] int MapDesktopSurface(IntPtr pLockedRect);
        [PreserveSig] int UnMapDesktopSurface();
        [PreserveSig] int ReleaseFrame();
    }

    [ComImport]
    [Guid("db6f6ddb-ac77-4e88-8253-819df9bbf140")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ID3D11Device
    {
        [PreserveSig] int CreateBuffer(IntPtr pDesc, IntPtr pInitialData, out IntPtr ppBuffer);
        [PreserveSig] int CreateTexture2D(ref D3D11_TEXTURE2D_DESC pDesc, IntPtr pInitialData, out IntPtr ppTexture2D);
    }

    [ComImport]
    [Guid("c0bfa96c-e089-44fb-8eaf-26f8796190da")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ID3D11DeviceContext
    {
        [PreserveSig] void SetPrivateData(ref Guid Name, uint DataSize, IntPtr pData);
        [PreserveSig] void SetPrivateDataInterface(ref Guid Name, IntPtr pUnknown);
        [PreserveSig] void GetPrivateData(ref Guid Name, ref uint pDataSize, IntPtr pData);
        [PreserveSig] void CopyResource(IntPtr pDstResource, IntPtr pSrcResource);
        [PreserveSig] void CopySubresourceRegion(IntPtr pDstResource, uint DstSubresource, uint DstX, uint DstY, uint DstZ, IntPtr pSrcResource, uint SrcSubresource, IntPtr pSrcBox);
        [PreserveSig] void ResolveSubresource(IntPtr pDstResource, uint DstSubresource, IntPtr pSrcResource, uint SrcSubresource, int Format);
        [PreserveSig] void GenerateMips(IntPtr pShaderResourceView);
        [PreserveSig] void CopyStructureCount(IntPtr pDstBuffer, uint DstAlignedByteOffset, IntPtr pSrcView);
        [PreserveSig] int Map(IntPtr pResource, uint Subresource, int MapType, uint MapFlags, ref D3D11_MAPPED_SUBRESOURCE pMappedResource);
        [PreserveSig] void Unmap(IntPtr pResource, uint Subresource);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_OUTPUT_DESC
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        public RECT DesktopCoordinates;
        public bool AttachedToDesktop;
        public int ModeRotation;
        public IntPtr Monitor;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_OUTDUPL_DESC
    {
        public DXGI_MODE_DESC ModeDesc;
        public int Rotation;
        public bool DesktopImageInSystemMemory;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_MODE_DESC
    {
        public int Width;
        public int Height;
        public DXGI_RATIONAL RefreshRate;
        public int Format;
        public int ScanlineOrdering;
        public int Scaling;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_RATIONAL
    {
        public uint Numerator;
        public uint Denominator;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_OUTDUPL_FRAME_INFO
    {
        public long LastPresentTime;
        public long LastMouseUpdateTime;
        public uint AccumulatedFrames;
        public bool RectsCoalesced;
        public bool ProtectedContentMasked;
        public DXGI_OUTDUPL_POINTER_POSITION PointerPosition;
        public uint TotalMetadataBufferSize;
        public uint PointerShapeBufferSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_OUTDUPL_POINTER_POSITION
    {
        public POINT Position;
        public bool Visible;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3D11_TEXTURE2D_DESC
    {
        public uint Width;
        public uint Height;
        public uint MipLevels;
        public uint ArraySize;
        public int Format;
        public DXGI_SAMPLE_DESC SampleDesc;
        public int Usage;
        public uint BindFlags;
        public uint CPUAccessFlags;
        public uint MiscFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DXGI_SAMPLE_DESC
    {
        public uint Count;
        public uint Quality;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3D11_MAPPED_SUBRESOURCE
    {
        public IntPtr pData;
        public int RowPitch;
        public int DepthPitch;
    }
}
