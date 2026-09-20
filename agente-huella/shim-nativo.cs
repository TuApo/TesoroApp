// ============================================================================
//  SHIM P/INVOKE HACIA dpfpdd.dll  —  U.are.U SDK for Windows
// ============================================================================
//
//  ESTE ES EL UNICO ARCHIVO QUE PUEDE HACER FALTA SUSTITUIR.
//
//  Si ya tienes un shim que produjo una captura fisica real en el equipo,
//  SOBRESCRIBE ESTE ARCHIVO CON EL TUYO y no toques nada mas: `capturador-
//  nativo.ps1` lo carga por ruta, no por contenido, y espera unicamente los
//  nombres publicos de abajo. Un layout de estructura equivocado no se puede
//  "casi acertar": o coincide byte a byte con el header del SDK o no funciona.
//
//  POR QUE ESTE LAYOUT Y NO OTRO
//  -----------------------------
//  Se corresponde con `dpfpdd.h` del U.are.U SDK, y la prueba fisica ya
//  realizada en este proyecto lo corrobora de forma independiente:
//
//      width 357 x height 392 = 139.944 bytes  ==  los bytes devueltos
//
//  Esa igualdad exacta solo se da con DPFPDD_IMG_FMT_PIXEL_BUFFER a 8 bpp:
//  un byte por pixel, sin cabecera ni relleno. Y los campos que reporto
//  (success, quality, score, width, height, dpi, bpp) son exactamente los que
//  devolvio la prueba, en ese orden.
//
//  RED DE SEGURIDAD DEL PROPIO SDK
//  -------------------------------
//  Todas las estructuras llevan un campo `size` que el llamante rellena con
//  su propio tamano. Si el layout no coincidiera, la API devuelve un codigo de
//  error limpio en vez de corromper memoria. Por eso un shim equivocado aqui
//  falla de forma ruidosa y localizada, no de forma silenciosa.
// ============================================================================

using System;
using System.Runtime.InteropServices;

public static class Dpfpdd
{
    private const string DLL = "dpfpdd.dll";
    public const int MAX_DEVICE_NAME_LENGTH = 1024;

    // ── Formatos de imagen ──────────────────────────────────────────────────
    // PIXEL_BUFFER = crudo, un byte por pixel. Es el que queremos: la huella
    // aqui es un artefacto documental, no una plantilla biometrica.
    public const uint IMG_FMT_PIXEL_BUFFER = 0;
    public const uint IMG_FMT_ANSI381      = 0x001B0401;
    public const uint IMG_FMT_ISO19794     = 0x01010007;

    public const uint IMG_PROC_DEFAULT  = 0;
    public const uint IMG_PROC_NONE     = 1;
    public const uint IMG_PROC_ENHANCED = 2;

    // Prioridad de apertura. COOPERATIVE deja convivir con otros clientes.
    public const uint PRIORITY_COOPERATIVE = 2;

    public const int SUCCESS = 0;

    [StructLayout(LayoutKind.Sequential)]
    public struct VER_INFO
    {
        public int major;
        public int minor;
        public int maintenance;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct HW_DESCR
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string vendor_name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string product_name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string serial_num;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HW_VERSION
    {
        public VER_INFO hw_ver;
        public VER_INFO fw_ver;
        public VER_INFO bcd_ver;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEV_INFO
    {
        public uint size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = MAX_DEVICE_NAME_LENGTH)] public string name;
        public HW_DESCR descr;
        public HW_VERSION ver;
        public uint modality;
        public uint technology;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CAPTURE_PARAM
    {
        public uint size;
        public uint image_fmt;
        public uint image_proc;
        public uint image_res;   // dpi. El 4500 son 500.
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IMAGE_INFO
    {
        public uint size;
        public uint width;
        public uint height;
        public uint res;
        public uint bpp;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CAPTURE_RESULT
    {
        public uint size;
        public int  success;
        public int  quality;
        public uint score;
        public IMAGE_INFO info;
    }

    // CallingConvention.Winapi = __stdcall en Windows, que es lo que declara
    // DPFPDD_API en el header del SDK.
    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern int dpfpdd_init();

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern int dpfpdd_exit();

    // Dos pasadas: primero con dev_infos = IntPtr.Zero para conocer el numero
    // de lectores, despues con el arreglo ya dimensionado.
    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern int dpfpdd_query_devices(ref uint dev_cnt, IntPtr dev_infos);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi, CharSet = CharSet.Ansi)]
    public static extern int dpfpdd_open(string dev_name, out IntPtr pdev);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi, CharSet = CharSet.Ansi)]
    public static extern int dpfpdd_open_ext(string dev_name, uint priority, out IntPtr pdev);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern int dpfpdd_close(IntPtr dev);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern int dpfpdd_cancel(IntPtr dev);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern int dpfpdd_capture(
        IntPtr dev,
        ref CAPTURE_PARAM capture_parm,
        uint timeout,
        ref CAPTURE_RESULT capture_result,
        ref uint image_size,
        byte[] image_data);
}
