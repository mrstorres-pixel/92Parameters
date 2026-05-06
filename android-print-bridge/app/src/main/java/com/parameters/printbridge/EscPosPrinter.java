package com.parameters.printbridge;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.UUID;

public class EscPosPrinter {
    public static final int CHARS_PER_LINE = 32;
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final Charset PRINTER_CHARSET = Charset.forName("CP437");

    public static void printReceipt(Context context, String macAddress, JSONObject receipt) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new Exception("Bluetooth is not available on this device.");
        if (!adapter.isEnabled()) throw new Exception("Bluetooth is turned off.");
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw new Exception("Bluetooth permission was not granted.");
        }

        BluetoothDevice device = adapter.getRemoteDevice(macAddress);
        BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
        adapter.cancelDiscovery();
        socket.connect();
        try {
            OutputStream out = socket.getOutputStream();
            out.write(buildReceiptBytes(receipt));
            out.flush();
        } finally {
            socket.close();
        }
    }

    public static byte[] buildReceiptBytes(JSONObject receipt) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, new byte[]{0x1B, 0x40}); // init
        write(out, new byte[]{0x1B, 0x61, 0x01}); // center
        writeBold(out, true);
        line(out, receipt.optString("businessName", "92 PARAMETERS CAFE"));
        writeBold(out, false);
        line(out, "");
        line(out, "THIS IS NOT AN OFFICIAL");
        line(out, "RECEIPT");
        line(out, "PLEASE ASK FOR BIR");
        line(out, "SERVICE INVOICE");
        write(out, new byte[]{0x1B, 0x61, 0x00}); // left
        divider(out);
        line(out, "Receipt No.: " + receipt.optString("receiptNo", ""));

        JSONArray items = receipt.optJSONArray("items");
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                String left = item.optInt("quantity", 1) + " x " + item.optString("name", "Item");
                String right = money(item.optDouble("lineTotal", 0));
                pair(out, left, right);
                if (item.optDouble("discount", 0) > 0) pair(out, "  Discount", "-" + trimNumber(item.optDouble("discount", 0)) + "%");
                if (item.optDouble("discountAmount", 0) > 0) pair(out, "  Cash discount", "-" + money(item.optDouble("discountAmount", 0)));
            }
        }

        divider(out);
        if (receipt.optDouble("subtotal", 0) > 0) pair(out, "Subtotal", money(receipt.optDouble("subtotal", 0)));
        if (receipt.optDouble("orderDiscount", 0) > 0) pair(out, "Order Discount", "-" + trimNumber(receipt.optDouble("orderDiscount", 0)) + "%");
        if (receipt.optDouble("orderDiscountAmount", 0) > 0) pair(out, "Order Disc Cash", "-" + money(receipt.optDouble("orderDiscountAmount", 0)));
        writeBold(out, true);
        pair(out, "TOTAL", money(receipt.optDouble("total", 0)));
        writeBold(out, false);
        if (receipt.optDouble("cashReceived", 0) > 0) {
            pair(out, "Cash Received", money(receipt.optDouble("cashReceived", 0)));
            pair(out, "Change", money(receipt.optDouble("change", 0)));
        }

        line(out, "");
        line(out, "Payment: " + receipt.optString("paymentMethod", ""));
        line(out, "Type: " + receipt.optString("orderType", ""));
        line(out, "Staff: " + receipt.optString("staffName", ""));
        line(out, "Date: " + receipt.optString("datetimeText", ""));
        line(out, "");
        write(out, new byte[]{0x1B, 0x61, 0x01}); // center
        line(out, receipt.optString("footer", "THANK YOU! SEE US AGAIN! :)"));
        write(out, new byte[]{0x1B, 0x61, 0x00});
        write(out, new byte[]{0x0A, 0x0A, 0x0A});
        write(out, new byte[]{0x1D, 0x56, 0x42, 0x00}); // cut, ignored by most 58mm mini printers
        return out.toByteArray();
    }

    private static void writeBold(ByteArrayOutputStream out, boolean enabled) {
        write(out, new byte[]{0x1B, 0x45, (byte) (enabled ? 1 : 0)});
    }

    private static void pair(ByteArrayOutputStream out, String left, String right) {
        if (left.length() + right.length() + 1 <= CHARS_PER_LINE) {
            line(out, left + spaces(CHARS_PER_LINE - left.length() - right.length()) + right);
            return;
        }
        line(out, left);
        line(out, spaces(Math.max(0, CHARS_PER_LINE - right.length())) + right);
    }

    private static void divider(ByteArrayOutputStream out) {
        line(out, "--------------------------------");
    }

    private static void line(ByteArrayOutputStream out, String text) {
        write(out, (sanitize(text) + "\n").getBytes(PRINTER_CHARSET));
    }

    private static void write(ByteArrayOutputStream out, byte[] bytes) {
        out.write(bytes, 0, bytes.length);
    }

    private static String money(double amount) {
        return "P" + String.format(Locale.US, "%,.2f", amount);
    }

    private static String trimNumber(double value) {
        if (value == Math.rint(value)) return String.valueOf((int) value);
        return String.format(Locale.US, "%.2f", value);
    }

    private static String sanitize(String text) {
        return String.valueOf(text)
            .replace("₱", "P")
            .replace("—", "-")
            .replace("–", "-")
            .replace("×", "x");
    }

    private static String spaces(int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) sb.append(' ');
        return sb.toString();
    }
}
